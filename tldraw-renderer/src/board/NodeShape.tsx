import { Button, Tooltip } from '@mui/material'
import {
    BaseBoxShapeTool,
    BaseBoxShapeUtil,
    DefaultColorStyle,
    HTMLContainer,
    StyleProp,
    T,
    TLBaseShape,
    TLDefaultColorStyle,
    getDefaultColorTheme,
} from '@tldraw/tldraw'
import { useEffect, useRef } from 'react'
import { truncateText } from './shapeUtils'

// Define a style that can be used across multiple shapes.
// The ID (myApp:filter) must be globally unique, so we recommend prefixing it with a namespace.

export type NodeShape = TLBaseShape<
    'node',
    {
        w: number
        h: number
        borderColor: string
        backgroundColor: string
        name: string
        iconPath: string
    }
>

// Utility function to fetch an image and convert to data URL
function convertImageToDataURL(imagePath: string) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'Anonymous'; // Attempt to address CORS issues
        image.onload = () => {
            let canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            let ctx = canvas.getContext('2d');
            ctx!.drawImage(image, 0, 0);
            const dataURL = canvas.toDataURL('image/png');
            resolve(dataURL);
        };
        image.onerror = () => {
            reject('Could not load image');
        };
        image.src = imagePath;
    });
}

export class NodeShapeUtil extends BaseBoxShapeUtil<NodeShape> {
    static override type = 'node' as const

    static override props = {
        w: T.number,
        h: T.number,
        borderColor: T.string,
        backgroundColor: T.string,
        name: T.string,
        iconPath: T.string,
    }

    override isAspectRatioLocked = (_shape: NodeShape) => false
    override canResize = (_shape: NodeShape) => false
    override canBind = (_shape: NodeShape) => true
    override hideRotateHandle = (_shape: NodeShape) => true


    override getDefaultProps(): NodeShape['props'] {
        return {
            w: 120,
            h: 120,
            borderColor: "black",
            backgroundColor: "white",
            name: "AWS Service",
            iconPath: "",
        }
    }


    component(shape: NodeShape) {


        return (
            <>
                <HTMLContainer
                    id={shape.id}
                    style={{
                        border: `2px solid ${shape.props.borderColor}`,
                        borderRadius: "0.25rem",
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'all',
                        backgroundColor: shape.props.backgroundColor,
                    }}
                >
                    <div className={`absolute top-0 left-0 text-center max-w-full p-1 text-sm text-black truncate rounded-br`}
                    >
                        {shape.props.name}
                    </div>
                    <img src={shape.props.iconPath} className='absolute bottom-4 h-16 w-16 rounded pointer-events-none select-none' />

                </HTMLContainer>

            </>

        )
    }


    async toSvg(shape: NodeShape) {
        const xmlns = 'http://www.w3.org/2000/svg';
        const padding = 5; // Padding around text
        const titleSize = 14; // Font size for text elements

        // Create the main SVG group
        const g = document.createElementNS(xmlns, 'g');

        // Create the background rectangle
        const rect = document.createElementNS(xmlns, 'rect');
        rect.setAttributeNS(null, 'width', shape.props.w.toString());
        rect.setAttributeNS(null, 'height', shape.props.h.toString());
        rect.setAttributeNS(null, 'rx', '4'); // match the borderRadius from the component style
        rect.setAttributeNS(null, 'fill', shape.props.backgroundColor);
        rect.setAttributeNS(null, 'stroke', shape.props.borderColor);
        rect.setAttributeNS(null, 'stroke-width', '2');

        // Append the rectangle to the main group
        g.appendChild(rect);

        // Create the text element for the shape's name
        const nameText = document.createElementNS(xmlns, 'text');
        nameText.textContent = shape.props.name;
        nameText.setAttributeNS(null, 'x', padding.toString());
        nameText.setAttributeNS(null, 'y', "17");
        nameText.setAttributeNS(null, 'style', `font-family: sans-serif; font-size: ${titleSize}px; fill: ${shape.props.borderColor};`);
        nameText.setAttributeNS(null, 'dominant-baseline', 'middle');

        // Truncate the text if it's too long
        truncateText(nameText, shape.props.w - 10); // Assume 5 padding on each side

        // Append the text element to the main group
        g.appendChild(nameText);

        const iconWidth = 64; // The width of the image

        const rectCenterX = shape.props.w / 2;
        const iconX = rectCenterX - (iconWidth / 2); // The x coordinate for the centered image

        // Calculate the y coordinate to position the image with a 30px margin from the bottom
        const iconHeight = 64; // The height of the image
        const iconY = shape.props.h - iconHeight - 16; // The y coordinate for the positioned image with bottom margin


        // Check if the PNG image can be converted to a data URL in the browser
        const icon = document.createElementNS(xmlns, 'image');
        try {
            const dataURL = await convertImageToDataURL(shape.props.iconPath);
            icon.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataURL as string);
        } catch (err) {
            console.error('Error converting image to data URL', err);
        }
        icon.setAttributeNS(null, 'x', iconX.toString());
        icon.setAttributeNS(null, 'y', iconY.toString());
        icon.setAttributeNS(null, 'width', iconWidth.toString());
        icon.setAttributeNS(null, 'height', iconHeight.toString());

        // Create a <clipPath> element to apply rounded corners to the image
        const clipPath = document.createElementNS(xmlns, 'clipPath');
        clipPath.setAttributeNS(null, 'id', 'rounded-corners');
        const clipRect = document.createElementNS(xmlns, 'rect');
        clipRect.setAttributeNS(null, 'x', iconX.toString());
        clipRect.setAttributeNS(null, 'y', iconY.toString());
        clipRect.setAttributeNS(null, 'width', iconWidth.toString());
        clipRect.setAttributeNS(null, 'height', iconHeight.toString());
        clipRect.setAttributeNS(null, 'rx', '4'); // Set the desired radius for rounded corners
        clipRect.setAttributeNS(null, 'ry', '4');
        clipPath.appendChild(clipRect);
        g.appendChild(clipPath);

        // Apply the clipPath to the image
        icon.setAttributeNS(null, 'clip-path', 'url(#rounded-corners)');

        // Add an 'onerror' event to handle loading errors
        icon.onerror = (e) => {
            console.error('Failed to load image', e);
        };

        g.appendChild(icon);

        // Return the SVG element <g>
        return g;
    }

    // Indicator — used when hovering over a shape or when it's selected; must return only SVG elements here
    indicator(shape: NodeShape) {
        return <rect width={shape.props.w} height={shape.props.h} />
    }

}

// Extending the base box shape tool gives us a lot of functionality for free.
export class NodeShapeTool extends BaseBoxShapeTool {
    static override id = 'node'
    static override initial = 'idle'
    override shapeType = 'node'
    props = {
        w: T.number,
        h: T.number,
        // You can re-use tldraw built-in styles...
        color: DefaultColorStyle,
        // ...or your own custom styles.
    }
}