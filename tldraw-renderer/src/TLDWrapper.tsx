import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeShapeUtil } from './board/NodeShape';
import { Editor, TLShapeId, Tldraw } from '@tldraw/tldraw';
import dagre from "dagre"
import Papa from "papaparse"
import { NodeModel, RootGraphModel, SubgraphModel, fromDot } from "ts-graphviz"
import { terraformResourcesCsv } from './terraformResourcesCsv';


const customShapeUtils = [NodeShapeUtil]

type NodeGroup = {
    nodes: NodeModel[],
    mainNode: NodeModel,
    connectionsOut: string[],
    connectionsIn: string[],
    name: string,
    type: string,
    iconPath: string,
    serviceName: string
    moduleName?: string
}

const TLDWrapper = () => {

    const [editor, setEditor] = useState<Editor | null>(null)

    const setAppToState = useCallback((editor: Editor) => {
        setEditor(editor)
    }, [])

    const defaultWidth = 120, defaultHeight = 120

    const checkHclBlockType = (blockId: string) => {
        let moduleName = ""
        if (blockId.startsWith("module.")) {
            moduleName = blockId.split(".")[1]
            blockId = blockId.split(".").slice(2).join(".")
        }
        const isModule = !blockId && moduleName

        const isData = blockId.startsWith("data.")
        const isVariable = blockId.startsWith("var.")
        const isLocal = blockId.startsWith("local.")
        const isOutput = blockId.startsWith("output.")
        const isProvider = blockId.startsWith("provider[")

        const isResource = blockId.startsWith("aws_")

        if (!isData && !isVariable && !isLocal && !isOutput && !isProvider && !isResource && !isModule) {
            console.warn("Unknown block type", blockId)
        }
        const splitBlockId = blockId.split(".")
        const isResourceWithName = isResource && splitBlockId.length > 1
        if (!isResource && !isModule) {
            blockId = splitBlockId.slice(1).join(".")
        }
        return { processedBlockId: blockId, isData, isVariable, isResource, isLocal, isOutput, isProvider, isModule, isResourceWithName, moduleName }
    }

    const getResourceNameAndType = (blockId: string) => {
        const resourceType = blockId.split(".") && blockId.split(".").filter(s => s.startsWith("aws_")).length > 0 ?
            blockId.split(".").filter(s => s.startsWith("aws_"))[0] : undefined
        const resourceName = resourceType && blockId.split(".").filter((s, index) => {
            return index > 0 && blockId.split(".")[index - 1] === resourceType
        })[0].split(" ")[0]
        return { resourceType, resourceName }
    }

    const parseModel = (model: RootGraphModel) => {
        const nodeGroups = new Map<string, NodeGroup>()
        const jsonArray = Papa.parse(terraformResourcesCsv, { delimiter: ",", header: true })
        console.log("jsonArray", jsonArray)
        model.subgraphs.forEach((subgraph) => {
            subgraph.nodes.forEach((node) => {
                let centralPart = node.id.split(" ")[1]
                if (centralPart) {
                    const { processedBlockId, isResourceWithName, moduleName } = checkHclBlockType(centralPart)
                    if (isResourceWithName) {
                        const { resourceType, resourceName } = getResourceNameAndType(processedBlockId)
                        if (resourceType && resourceName && jsonArray) {
                            jsonArray.data.forEach((row: any) => {
                                if (row["Main Diagram Blocks"].split(",").some((s: string) => s === resourceType)) {
                                    nodeGroups.set(node.id.split(" ")[1], {
                                        nodes: [node],
                                        mainNode: node,
                                        name: resourceName,
                                        type: resourceType,
                                        serviceName: row["Service Name"],
                                        iconPath: row["Icon Path"].trim(),
                                        connectionsIn: [],
                                        connectionsOut: [],
                                        moduleName: moduleName
                                    })
                                }
                            })
                        }
                    }
                }
            })
        })
        console.log("nodeGroups1", nodeGroups)

        nodeGroups.forEach((nodeGroup) => {
            console.log("nodeGroup for edges analysis", nodeGroup)
            getConnectedNodes(nodeGroup.mainNode, nodeGroup, nodeGroups, model.subgraphs[0], true, jsonArray)
            getConnectedNodes(nodeGroup.mainNode, nodeGroup, nodeGroups, model.subgraphs[0], false, jsonArray)
        })

        console.log("FINISHED ANALYSIS EDGES", nodeGroups)
        // Compute connections between groups
        model.subgraphs[0].edges.forEach((edge) => {
            const edgeFromId = (edge.targets[0] as any).id
            const edgeToId = (edge.targets[1] as any).id

            const fromGroup = Array.from(nodeGroups).filter(([id, group]) => {
                return group.nodes.some((n) => {
                    return n.id === edgeFromId
                })
            })[0]
            const toGroup = Array.from(nodeGroups).filter(([id, group]) => {
                return group.nodes.some((n) => {
                    return n.id === edgeToId
                })
            })[0]
            if (fromGroup && toGroup && fromGroup !== toGroup) {
                const fromGroupKey = fromGroup[0]
                const toGroupKey = toGroup[0]
                if (!fromGroup[1].connectionsOut.includes(toGroupKey) && !toGroup[1].connectionsIn.includes(fromGroupKey)) {
                    fromGroup[1].connectionsOut.push(toGroupKey)
                    toGroup[1].connectionsIn.push(fromGroupKey)
                }
            }
        })
        console.log("nodeGroups", nodeGroups)
        computeLayout(nodeGroups)
    }

    const computeLayout = (nodeGroups: Map<string, NodeGroup>) => {
        const g = new dagre.graphlib.Graph({ compound: true });
        g.setGraph({ rankdir: "TB", ranksep: 120 });
        g.setDefaultEdgeLabel(function () { return {}; });
        nodeGroups.forEach((nodeGroup, key) => {

            g.setNode(key, { label: nodeGroup.name, width: defaultWidth, height: defaultHeight })
            nodeGroup.connectionsOut.forEach((connection) => {
                g.setEdge(key, connection)
            })
            if (nodeGroup.moduleName) {
                if (!g.hasNode("module." + nodeGroup.moduleName)) {
                    g.setNode("module." + nodeGroup.moduleName, { label: nodeGroup.moduleName })
                }
                g.setParent(key, "module." + nodeGroup.moduleName)
            }
        })
        dagre.layout(g);
        const date = Date.now()

        editor?.createShapes(
            g.nodes().filter((id) => {
                return g.children(id) && g.children(id)!.length > 0
            }).map((id) => {
                const node = g.node(id);
                return {
                    id: "shape:" + id + date as TLShapeId,
                    type: "frame",
                    x: node.x - node.width / 2,
                    y: node.y - node.height / 2,
                    props: {
                        name: id,
                        w: node.width,
                        h: node.height,
                    }
                }
            }))

        editor?.createShapes(
            g.nodes().filter((id) => {
                return !g.children(id) || g.children(id)!.length === 0
            }).map((id) => {
                const node = g.node(id);


                return {
                    id: "shape:" + id + date as TLShapeId,
                    type: "node",
                    x: node.x - node.width / 2,
                    y: node.y - node.height / 2,
                    props: {
                        name: node.label,
                        iconPath: nodeGroups.get(id)?.iconPath,
                    }
                }
            })
        )

        const arrowShapes: any[] = []

        nodeGroups.forEach((nodeGroup, id) => {
            nodeGroup.connectionsOut.forEach((connection) => {
                const connectionNode = nodeGroups.get(connection)
                if (connectionNode) {
                    const fromShape = editor?.getShape("shape:" + id + date as TLShapeId)
                    const toShape = editor?.getShape("shape:" + connection + date as TLShapeId)
                    if (fromShape && toShape) {
                        arrowShapes.push(
                            {
                                id: "shape:" + id + "-" + connection + date as TLShapeId,
                                type: "arrow",
                                props: {
                                    size: "s",
                                    start: {
                                        type: "binding",
                                        boundShapeId: fromShape.id,
                                        normalizedAnchor: {
                                            x: 0.5,
                                            y: 0.5
                                        },
                                        isExact: false
                                    },
                                    end: {
                                        type: "binding",
                                        boundShapeId: toShape.id,
                                        normalizedAnchor: {
                                            x: 0.5,
                                            y: 0.5
                                        },
                                        isExact: false
                                    }
                                }
                            }
                        )
                    }
                }
            })
        })
        editor?.createShapes(arrowShapes)
        console.log("Created shapes", editor?.getPageShapeIds(editor.getCurrentPage()))
    }


    const getConnectedNodes = (node: NodeModel, nodeGroup: NodeGroup, nodeGroups: Map<string, NodeGroup>, subgraph: SubgraphModel, start: boolean, jsonArray: Papa.ParseResult<unknown>) => {
        subgraph.edges.filter((e) => {
            return (e.targets[start ? 0 : 1] as any).id === node.id
        }).forEach((edge, index) => {
            console.log("edge", index, edge)
            const edgeToId = (edge.targets[start ? 1 : 0] as any).id
            let centralPart = edgeToId.split(" ")[1]
            if (centralPart) {
                const { isResourceWithName, processedBlockId, isData } = checkHclBlockType(centralPart)

                if (isResourceWithName || isData) {
                    const { resourceType, resourceName } = getResourceNameAndType(processedBlockId)
                    const isNodePresent = Array.from(nodeGroups.values()).some((group) => {
                        return group.nodes.some((n) => {
                            return n.id === (edge.targets[start ? 1 : 0] as any).id
                        })
                    })
                    if (resourceType && resourceName && jsonArray && !isNodePresent &&
                        jsonArray.data.some((row: any) => {
                            return row["Main Diagram Blocks"].split(",").some((s: string) => s === nodeGroup.type) &&
                                (row["Missing Resources"].split(",").some((s: string) => s === resourceType) ||
                                    row["Data Sources"].split(",").some((s: string) => s === resourceType))
                        })) {
                        const newNode = subgraph.nodes.filter((n) => { return n.id === (edge.targets[start ? 1 : 0] as any).id })[0]
                        if (newNode) {
                            nodeGroup.nodes.push(newNode)
                            console.log("GOING DEEPER 1")
                            getConnectedNodes(newNode, nodeGroup, nodeGroups, subgraph, start, jsonArray)
                            console.log("GOING DEEPER 2")
                            getConnectedNodes(newNode, nodeGroup, nodeGroups, subgraph, !start, jsonArray)
                        }
                    }
                }
            }
        })
    }
    const textAreaRef = useRef<
        HTMLTextAreaElement | null
    >(null)


    const handleRenderButtonClick = () => {
        console.log("clicked btn")
        if (textAreaRef.current && textAreaRef.current.value) {
            console.log("graphvizText", textAreaRef.current.value)
            const model = fromDot(textAreaRef.current.value)
            parseModel(model)
        }
    }


    return (
        <div style={{
            position: "fixed",
            inset: 0,
        }}>
            <div style={{
                height: "100%",
                transitionProperty: "all",
                transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                transitionDuration: "150ms",
            }}>
                <Tldraw
                    shapeUtils={customShapeUtils}
                    onMount={setAppToState}
                />
                <textarea
                    ref={textAreaRef}
                    id='inkdrop-graphviz-textarea'
                />
                <button
                    onClick={handleRenderButtonClick}
                    id="render-button">
                    Render
                </button>
            </div>
        </div>
    );
};

export default TLDWrapper;