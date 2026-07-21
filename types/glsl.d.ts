// Allow importing .glsl files as raw strings
declare module "*.glsl" {
  const content: string;
  export default content;
}
