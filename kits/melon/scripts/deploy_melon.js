const namehash = require('eth-ens-namehash').hash

const getAccounts = require('@aragon/os/scripts/helpers/get-accounts')
const deployDAOFactory = require('@aragon/os/scripts/deploy-daofactory.js')
const logDeploy = require('@aragon/os/scripts/helpers/deploy-logger')

const getEventResult = (receipt, event, param) => receipt.logs.filter(l => l.event == event)[0].args[param]
const getToken = (receipt, index=0) => receipt.logs.filter(l => l.event == 'DeployToken')[index].args.token
const getAppProxy = (receipt, id, index=0) => receipt.logs.filter(l => l.event == 'InstalledApp' && l.args.appId == id)[index].args.appProxy

const apps = ['agent', 'finance', 'token-manager', 'vault', 'voting']
const appIds = apps.map(app => namehash(require(`@aragon/apps-${app}/arapp`).environments.default.appName))

const globalArtifacts = this.artifacts // Not injected unless called directly via truffle
const globalWeb3 = this.web3 // Not injected unless called directly via truffle
const defaultOwner = process.env.OWNER
const defaultENSAddress = process.env.ENS
const defaultDAOFactoryAddress = process.env.DAO_FACTORY
const defaultMinimeTokenFactoryAddress = process.env.MINIME_TOKEN_FACTORY

module.exports = async (
  truffleExecCallback,
  {
    artifacts = globalArtifacts,
    web3 = globalWeb3,
    owner = defaultOwner,
    ensAddress = defaultENSAddress,
    daoFactoryAddress = defaultDAOFactoryAddress,
    minimeTokenFactoryAddress = defaultMinimeTokenFactoryAddress,
    mainVotingVoteTime = 0,
    supermajorityVotingVoteTime = 0,
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

  try {
    if (!owner) {
      const accounts = await getAccounts(web3)
      owner = accounts[0]
      log(`OWNER env variable not found, setting APM owner to the provider's first account: ${owner}`)
    }

    log(`${kitName} with ENS ${ensAddress}, owner ${owner}`)

    const DAOFactory = artifacts.require('DAOFactory')
    const ENS = artifacts.require('ENS')
    const MiniMeTokenFactory = artifacts.require('MiniMeTokenFactory')

    if (!ensAddress) {
      errorOut('ENS environment variable not passed, aborting.')
    }
    log('Using ENS', ensAddress)
    const ens = await ENS.at(ensAddress)

    if (!daoFactoryAddress) {
      const daoFactory = (await deployDAOFactory(null, { artifacts, verbose: false })).daoFactory
      daoFactoryAddress = daoFactory.address
    }
    log(`Using DAOFactory: ${daoFactoryAddress}`)

    const apmAddress = await (await artifacts.require('PublicResolver').at(await ens.resolver(namehash('aragonpm.eth')))).addr(namehash('aragonpm.eth'))
    if (!apmAddress) {
      errorOut('No APM found for ENS, aborting.')
    }
    log('APM', apmAddress);
    const apm = await artifacts.require('APMRegistry').at(apmAddress)

    for (let i = 0; i < apps.length; i++) {
      if (await ens.owner(appIds[i]) == '0x0000000000000000000000000000000000000000') {
        errorOut(`Missing app ${apps[i]}, aborting.`)
      }
    }

    let minimeFac
    if (minimeTokenFactoryAddress) {
      log(`Using provided MiniMeTokenFactory: ${minimeTokenFactoryAddress}`)
      minimeFac = await MiniMeTokenFactory.at(minimeTokenFactoryAddress)
    } else {
      minimeFac = await MiniMeTokenFactory.new()
      log('Deployed MiniMeTokenFactory:', minimeFac.address)
    }

    const melonKit = await artifacts.require(kitName).new(daoFactoryAddress, ensAddress, minimeFac.address)
    log('Kit address:', melonKit.address)
    await logDeploy(melonKit)

    // First transaction
    log('\n- First transaction:\n')

    let melonReceipt1
    if (mainVotingVoteTime > 0 && supermajorityVotingVoteTime > 0) {
      melonReceipt1 = await melonKit.newInstance1WithVotingTimes([], [owner], mainVotingVoteTime, supermajorityVotingVoteTime)
    } else {
      melonReceipt1 = await melonKit.newInstance1([], [owner])
    }
    const gasUsed1 = melonReceipt1.receipt.cumulativeGasUsed
    const melonAddress = getEventResult(melonReceipt1, 'DeployInstance', 'dao')
    log('Melon DAO address: ', melonAddress)

    // generated tokens
    const mainTokenAddress = getToken(melonReceipt1, 0)
    log('General Membership Token: ', mainTokenAddress)
    // generated apps
    const vaultAddress = getAppProxy(melonReceipt1, appIds[3])
    log('Vault: ', vaultAddress)
    const financeAddress = getAppProxy(melonReceipt1, appIds[1])
    log('Finance: ', financeAddress)
    const mainTokenManagerAddress = getAppProxy(melonReceipt1, appIds[2], 0)
    log('General Membership Token Manager: ', mainTokenManagerAddress)
    const mainVotingAddress = getAppProxy(melonReceipt1, appIds[4], 0)
    log('General Memebership Voting: ', mainVotingAddress)
    const supermajorityVotingAddress = getAppProxy(melonReceipt1, appIds[4], 1)
    log('Supermajority Voting: ', supermajorityVotingAddress)

    // Second transaction
    log('\n- Second transaction:\n')
    const melonReceipt2 = await melonKit.newInstance2(melonAddress, mainVotingAddress, supermajorityVotingAddress, [owner])
    const gasUsed2 = melonReceipt2.receipt.cumulativeGasUsed

    // generated tokens
    const mtcTokenAddress = getToken(melonReceipt2, 0)
    log('MTC Token: ', mtcTokenAddress)
    // generated apps
    const mtcTokenManagerAddress = getAppProxy(melonReceipt2, appIds[2], 0)
    log('MTC Token Manager: ', mtcTokenManagerAddress)
    const mtcVotingAddress = getAppProxy(melonReceipt2, appIds[4], 0)
    log('MTC Voting: ', mtcVotingAddress)
    const protocolAgentAddress = getAppProxy(melonReceipt2, appIds[0], 0)
    log('Protocol Agent: ', protocolAgentAddress)
    const technicalAgentAddress = getAppProxy(melonReceipt2, appIds[0], 1)
    log('Technical Agent: ', technicalAgentAddress)

    log('Gas used:', gasUsed1, '+', gasUsed2, '=', parseInt(gasUsed1, 10) + parseInt(gasUsed2, 10))

    if (typeof truffleExecCallback === 'function') {
      // Called directly via `truffle exec`
      truffleExecCallback()
    } else {
      return {
        melonKitAddress: melonKit.address,
        melonAddress,
        mainTokenAddress,
        mtcTokenAddress,
        financeAddress,
        mainTokenManagerAddress,
        mtcTokenManagerAddress,
        vaultAddress,
        mainVotingAddress,
        supermajorityVotingAddress,
        mtcVotingAddress,
        protocolAgentAddress,
        technicalAgentAddress
      }
    }
  } catch(e) {
    errorOut(e)
  }
}
