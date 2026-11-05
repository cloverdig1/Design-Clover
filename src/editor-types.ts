export type Point = {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  smooth?: boolean;
};

export type GradientStop = {
  offset: string;
  color: string;
  opacity: number;
};

export type ObjectGradient = {
  type: "linear" | "radial";
  x1?: string;
  y1?: string;
  x2?: string;
  y2?: string;
  cx?: string;
  cy?: string;
  r?: string;
  fx?: string;
  fy?: string;
  stops: GradientStop[];
};

export type ObjectResponsiveOverrides = Partial<Record<"desktop" | "tablet" | "mobile", Partial<{
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}>>>;

export type ObjectLayout = {
  mode: "absolute" | "flex" | "grid";
  direction?: "row" | "column";
  gap?: number;
  padding?: number;
  margin?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  columns?: number;
  widthMode?: "fixed" | "auto" | "percent" | "fill" | "hug";
  heightMode?: "fixed" | "auto" | "percent" | "fill" | "hug";
  widthPercent?: number;
  heightPercent?: number;
  anchors?: Array<"left" | "right" | "top" | "bottom" | "center-x" | "center-y">;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};

export type VectorObject = {
  id: string;
  name: string;
  type: "rect" | "ellipse" | "text" | "path" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  rotation: number;
  text?: string;
  href?: string;
  alt?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textAnchor?: "start" | "middle" | "end";
  letterSpacing?: number;
  textDecoration?: string;
  visible?: boolean;
  locked?: boolean;
  groupId?: string;
  groupPath?: string[];
  groupNames?: string[];
  points?: Point[];
  closed?: boolean;
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  fillOpacity?: number;
  opacity?: number;
  fillRule?: "nonzero" | "evenodd";
  strokeDasharray?: string;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  cornerRadius?: number;
  gradient?: ObjectGradient;
  imageData?: string;
  shadow?: string;
  responsiveOverrides?: ObjectResponsiveOverrides;
  layout?: ObjectLayout;
  semanticRole?: string;
  componentDefinitionId?: string;
  componentInstanceId?: string;
  componentSourceId?: string;
  componentOverrides?: Partial<Pick<VectorObject, "text" | "imageData" | "fill">>;
  tokenRefs?: Partial<Record<"fill" | "fontFamily" | "fontSize" | "fontWeight" | "cornerRadius" | "shadow" | "gap" | "width" | "height", string>>;
};
