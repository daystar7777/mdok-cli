/** CJK in math mode is rendered with the engine's Unicode fallback; it is not
 * an unknown TeX command. Other strict compatibility failures remain errors. */
export const katexStrict=(code:string):'ignore'|'error'=>code==='unicodeTextInMathMode'?'ignore':'error';
