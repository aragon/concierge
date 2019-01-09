const namehash = require('eth-ens-namehash').hash

const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')
const deployDAOFactory = require('@aragon/os/scripts/deploy-daofactory.js')
const logDeploy = require('@aragon/os/scripts/helpers/deploy-logger')

const getEventResult = (receipt, event, param) => receipt.logs.filter(l => l.event == event)[0].args[param]
const getToken = (receipt, index=0) => receipt.logs.filter(l => l.event == 'DeployToken')[index].args.token
const getAppProxy = (receipt, id, index=0) => receipt.logs.filter(l => l.event == 'InstalledApp' && l.args.appId == id)[index].args.appProxy

const apps = ['finance', 'token-manager', 'vault', 'voting']
const appIds = apps.map(app => namehash(require(`@aragon/apps-${app}/arapp`).environments.default.appName))

const globalArtifacts = this.artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 // Not injected unless called directly via truffle
const defaultOwner = process.env.OWNER
const defaultENSAddress = process.env.ENS
const defaultDAOFactoryAddress = process.env.DAO_FACTORY

module.exports = async (
  truffleExecCallback,
  {
    artifacts = globalArtifacts,
    web3 = globalWeb3,
    owner = defaultOwner,
    ensAddress = defaultENSAddress,
    daoFactoryAddress = defaultDAOFactoryAddress,
    verbose = true
  } = {}
) => {
  const kitName = 'MelonKit'

  const log = (...args) => {
    if (verbose) { console.log(...args) }
  }

  const errorOut = (msg) => {
    console.error(msg)
    throw new Error(msg)
  }

  if (!owner) {
    const accounts = await getAccounts(web3)
    owner = accounts[0]
    log('OWNER env variable not found, setting APM owner to the provider\'s first account')
  }

  log(`${kitName} with ENS ${ensAddress}, owner ${owner}`)

  const TokenFactoryWrapper = artifacts.require('TokenFactoryWrapper')
  const DAOFactory = artifacts.require('DAOFactory')
  const ENS = artifacts.require('ENS')

  if (!ensAddress) {
    errorOut('ENS environment variable not passed, aborting.')
  }
  log('Using ENS', ensAddress)
  const ens = ENS.at(ensAddress)

  if (!daoFactoryAddress) {
    const daoFactory = (await deployDAOFactory(null, { artifacts, verbose: false })).daoFactory
    daoFactoryAddress = daoFactory.address
  }
  log(`Using DAOFactory: ${daoFactoryAddress}`)

  const apmAddress = await artifacts.require('PublicResolver').at(await ens.resolver(namehash('aragonpm.eth'))).addr(namehash('aragonpm.eth'))
  if (!apmAddress) {
    errorOut('No APM found for ENS, aborting.')
  }
  log('APM', apmAddress);
  const apm = artifacts.require('APMRegistry').at(apmAddress)

  for (let i = 0; i < apps.length; i++) {
    if (await ens.owner(appIds[i]) == '0x0000000000000000000000000000000000000000') {
      errorOut(`Missing app ${apps[i]}, aborting.`)
    }
  }

  const melonKit = await artifacts.require(kitName).new(daoFactoryAddress, ensAddress)
  log('Kit address:', melonKit.address)
  await logDeploy(melonKit)

  const melonReceipt = await melonKit.newInstance([], [owner])
  log('Gas used:', melonReceipt.receipt.cumulativeGasUsed)
  const melonAddress = getEventResult(melonReceipt, 'DeployInstance', 'dao')
  log('Melon DAO address: ', melonAddress)

  // generated tokens
  const mainTokenAddress = getToken(melonReceipt, 0)
  const mtcTokenAddress = getToken(melonReceipt, 1)

  // generated apps
  const financeAddress = getAppProxy(melonReceipt, appIds[0])
  const mainTokenManagerAddress = getAppProxy(melonReceipt, appIds[1], 0)
  const mtcTokenManagerAddress = getAppProxy(melonReceipt, appIds[1], 1)
  const vaultAddress = getAppProxy(melonReceipt, appIds[2])
  const mainVotingAddress = getAppProxy(melonReceipt, appIds[3], 0)
  const supermajorityVotingAddress = getAppProxy(melonReceipt, appIds[3], 1)
  const mtcVotingAddress = getAppProxy(melonReceipt, appIds[3], 2)

  log('Vault: ', vaultAddress)
  log('Finance: ', financeAddress)
  log('General Membership Token Manager: ', mainTokenManagerAddress)
  log('MTC Token Manager: ', mtcTokenManagerAddress)
  log('General Memebership Voting: ', mainVotingAddress)
  log('Supermajority Voting: ', supermajorityVotingAddress)
  log('MTC Voting: ', mtcVotingAddress)

  if (typeof truffleExecCallback === 'function') {
    // Called directly via `truffle exec`
    truffleExecCallback()
  } else {
    return {
      melonAddress,
      mainTokenAddress,
      mtcTokenAddress,
      financeAddress,
      mainTokenManagerAddress,
      mtcTokenManagerAddress,
      vaultAddress,
      mainVotingAddress,
      supermajorityVotingAddress,
      mtcVotingAddress
    }
  }
}
