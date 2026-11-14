export {};

const output = document.getElementById('result');
const hosts = new Set<string>();
const nativeFetch = window.fetch.bind(window);

window.fetch = async (input, init) => {
  const request = new Request(input, init);
  hosts.add(new URL(request.url).host);
  return nativeFetch(request);
};

try {
  const { InferenceClient } = await import('@nearai/inference-sdk');
  const client = new InferenceClient({
    baseUrl: 'https://cloud-api.near.ai/v1',
    e2ee: true,
    signingAlgo: 'ed25519',
    attestationCacheTimeToLiveMs: 0,
  });
  const verified = await client.verify('z-ai/glm-5.3-flash');
  const { NearConnector } = await import('@hot-labs/near-connect');
  const walletConnector = new NearConnector({ features: { signInAndSignMessage: true }, cspNonce: 'fineprint-wallet' });
  await walletConnector.whenManifestLoaded;
  const hotWallet = walletConnector.availableWallets.find((wallet) => wallet.manifest.id === 'hot-wallet');
  const walletCount = walletConnector.availableWallets.length;
  const passed = verified.gateway.tcbStatus === 'UpToDate'
    && verified.models.length > 0
    && verified.models.every((model) => model.tcbStatus === 'UpToDate' && model.gpuEvidence === 'verified')
    && hotWallet?.manifest.features.signInAndSignMessage === true
    && walletCount > 1;
  const message = `${passed ? 'PASS' : 'FAIL'} | gateway ${verified.gateway.tcbStatus} | model ${verified.models.map((model) => `${model.tcbStatus}/${model.gpuEvidence}`).join(',')} | NEAR wallets ${walletCount} | hosts ${[...hosts].sort().join(',')}`;
  if (output) output.textContent = message;
  document.body.dataset.result = passed ? 'pass' : 'fail';
} catch (error) {
  if (output) output.textContent = `FAIL | ${error instanceof Error ? error.message : String(error)}`;
  document.body.dataset.result = 'fail';
}
