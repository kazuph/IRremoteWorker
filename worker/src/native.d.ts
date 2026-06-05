declare module "../native/dist/ir_native.js" {
  type NativeModule = {
    ccall: (
      ident: string,
      returnType: "string",
      argTypes: Array<"string" | "number">,
      args: Array<string | number>,
    ) => string;
  };

  export default function createNativeModule(): Promise<NativeModule>;
}
