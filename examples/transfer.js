const { ethers } = require('ethers');
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { convertH160ToSS58 } = require('./address-mapping.js');

// PROTECT YOUR PRIVATE KEYS WELL, NEVER COMMIT THEM TO GITHUB OR SHARE WITH ANYONE
const { ethPrivateKey, subSeed, rpcUrl, wsUrl } = require('./config.js');

function sendTransaction(api, call, signer) {
    return new Promise((resolve, reject) => {
      let unsubscribed = false;
  
      const unsubscribe = call.signAndSend(signer, ({ status, events, dispatchError }) => {
        const safelyUnsubscribe = () => {
          if (!unsubscribed) {
            unsubscribed = true;
            unsubscribe.then(() => {})
              .catch(error => console.error('Failed to unsubscribe:', error));
          }
        };
        
        // Check for transaction errors
        if (dispatchError) {
          let errout = dispatchError.toString();
          if (dispatchError.isModule) {
            // for module errors, we have the section indexed, lookup
            const decoded = api.registry.findMetaError(dispatchError.asModule);
            const { docs, name, section } = decoded;
            errout = `${name}: ${docs}`;
          }
          safelyUnsubscribe();
          reject(Error(errout));
        }
        // Log and resolve when the transaction is included in a block
        if (status.isInBlock) {
          safelyUnsubscribe();
          resolve(status.asInBlock);
        }
      }).catch((error) => {
        reject(error);
      });
    });
}

async function main() {
    const wsProvider = new WsProvider(wsUrl);
    const api = await ApiPromise.create({ provider: wsProvider });
    const keyring = new Keyring({ type: 'sr25519' });

    const sender = keyring.addFromUri(subSeed); // Your sender's private key/seed

    // Get ethereum address that matches the private key from the secrets file
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(ethPrivateKey, provider);
    const recipientEthereumAddress = signer.address;

    const ss58Address = convertH160ToSS58(recipientEthereumAddress);
    console.log(`Mirror: ${ss58Address}`);
    // Amount to send: 1 TAO on Substrate side = 1*10^9
    const amount = "1000000000";

    // Alice funds herself with 1M TAO
    const txSudoSetBalance = api.tx.sudo.sudo(
        api.tx.balances.forceSetBalance(sender.address, "1000000000000000")
    );
    await sendTransaction(api, txSudoSetBalance, sender);
    console.log('Balace force-set');

    // Create a transfer transaction
    const transfer = api.tx.balances.transferKeepAlive(ss58Address, amount);

    // Sign and send the transaction
    await sendTransaction(api, transfer, sender);
    console.log(`Transfer sent to ${recipientEthereumAddress} (its ss58 mirror address is: ${ss58Address})`);
    await api.disconnect();
}

main().catch(console.error);
