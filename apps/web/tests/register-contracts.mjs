import { registerHooks } from 'node:module';

// Nodeの直接実行でも、Webのtsconfig/Viteと同じ共有契約を読む。
registerHooks({
  resolve(specifier, context, nextResolve) {
    const contractSpecifier = specifier === '@contracts'
      ? new URL('../../api/src/contracts/index.ts', import.meta.url).href
      : specifier;
    return nextResolve(
      contractSpecifier,
      context,
    );
  },
});
