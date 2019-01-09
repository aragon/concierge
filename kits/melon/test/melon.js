const getBlockNumber = require('@aragon/test-helpers/blockNumber')(web3)
const getBlock = require('@aragon/test-helpers/block')(web3)
const getBalance = require('@aragon/test-helpers/balance')(web3)
const timeTravel = require('@aragon/test-helpers/timeTravel')(web3)
const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const { encodeCallScript, EMPTY_SCRIPT } = require('@aragon/test-helpers/evmScript')
const deployMelon = require('../scripts/deploy_melon.js')

const Finance = artifacts.require('Finance')
const TokenManager = artifacts.require('TokenManager')
const Vault = artifacts.require('Vault')
const Voting = artifacts.require('Voting')

const getContract = name => artifacts.require(name)

const pct16 = x => new web3.BigNumber(x).times(new web3.BigNumber(10).toPower(16))
const getEventResult = (receipt, event, param) => receipt.logs.filter(l => l.event == event)[0].args[param]
const createdVoteId = receipt => getEventResult(receipt, 'StartVote', 'voteId')

contract('Melon Kit', accounts => {
  const ETH = '0x0'
  const NO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const NEEDED_SUPPORT = pct16(50)
  const NEEDED_SUPPORT_SUPERMAJORITY = '666666666666666666'
  const MINIMUM_ACCEPTANCE_QUORUM = 0
  const VOTING_TIME = 48 * 3600 // 48h
  let daoAddress,
      mainTokenManager, mtcTokenManager,
      finance, vault,
      mainVoting, supermajorityVoting, mtcVoting

  const owner = accounts[0]
  const holder16 = accounts[1]
  const holder33 = accounts[2]
  const holder51 = accounts[3]
  const nonHolder = accounts[4]

  before(async () => {
    // create Melon Kit
    const {
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
    } = await deployMelon(null, {artifacts, web3, owner})

    daoAddress = melonAddress

    finance = Finance.at(financeAddress)
    mainTokenManager = Finance.at(mainTokenManagerAddress)
    mtcTokenManager = Finance.at(mtcTokenManagerAddress)
    vault = Vault.at(vaultAddress)
    mainVoting = Voting.at(mainVotingAddress)
    supermajorityVoting = Voting.at(supermajorityVotingAddress)
    mtcVoting = Voting.at(mtcVotingAddress)

    // TODO: it will fail as it needs a vote!
    // mint tokens: 2 MEB (general) + 5 MTC
    const mainToken = artifacts.require('MiniMeToken').at(mainTokenAddress)
    for (let i = 0; i < 2; i++)
      await mainToken.generateTokens(accounts[i], 1)
    const mtcToken = artifacts.require('MiniMeToken').at(mtcTokenAddress)
    for (let i = 2; i < 7; i++)
      await mtcToken.generateTokens(accounts[i], 1)
  })

  context('Creating a DAO and votes', () => {

    it('creates and initializes a DAO', async() => {
      assert.notEqual(daoAddress, '0x0', 'Instance not generated')
      assert.equal((await mainVoting.supportRequiredPct()).toString(), NEEDED_SUPPORT.toString())
      assert.equal((await mainVoting.minAcceptQuorumPct()).toString(), MINIMUM_ACCEPTANCE_QUORUM.toString())
      assert.equal((await mainVoting.voteTime()).toString(), VOTING_TIME.toString())
      assert.equal((await supermajorityVoting.supportRequiredPct()).toString(), NEEDED_SUPPORT_SUPERMAJORITY)
      assert.equal((await supermajorityVoting.minAcceptQuorumPct()).toString(), MINIMUM_ACCEPTANCE_QUORUM.toString())
      assert.equal((await supermajorityVoting.voteTime()).toString(), VOTING_TIME.toString())
    })

    it('has correct permissions', async () =>{
      const dao = getContract('Kernel').at(daoAddress)
      const acl = getContract('ACL').at(await dao.acl())

      const checkRole = async (appAddress, permission, managerAddress, appName='', roleName='', granteeAddress=managerAddress) => {
        assert.equal(await acl.getPermissionManager(appAddress, permission), managerAddress, `${appName} ${roleName} Manager should match`)
        assert.isTrue(await acl.hasPermission(granteeAddress, appAddress, permission), `Grantee should have ${appName} role ${roleName}`)
      }

      // app manager role
      await checkRole(daoAddress, await dao.APP_MANAGER_ROLE(), mainVoting.address, 'Kernel', 'APP_MANAGER')

      // create permissions role
      await checkRole(acl.address, await acl.CREATE_PERMISSIONS_ROLE(), mainVoting.address, 'ACL', 'CREATE_PERMISSION')

      // evm script registry
      const regConstants = await getContract('EVMScriptRegistryConstants').new()
      const reg = getContract('EVMScriptRegistry').at(await acl.getEVMScriptRegistry())
      assert.equal(await acl.getPermissionManager(reg.address, await reg.REGISTRY_ADD_EXECUTOR_ROLE()), NO_ADDRESS, 'EVMScriptRegistry ADD_EXECUTOR Manager should match')
      assert.equal(await acl.getPermissionManager(reg.address, await reg.REGISTRY_MANAGER_ROLE()), NO_ADDRESS, 'EVMScriptRegistry REGISTRY_MANAGER Manager should match')

      // vault
      await checkRole(vault.address, await vault.TRANSFER_ROLE(), mainVoting.address, 'Vault', 'TRANSFER', finance.address)

      // finance
      await checkRole(finance.address, await finance.CREATE_PAYMENTS_ROLE(), mainVoting.address, 'Finance', 'CREATE_PAYMENTS', mainVoting.address)
      await checkRole(finance.address, await finance.EXECUTE_PAYMENTS_ROLE(), mainVoting.address, 'Finance', 'EXECUTE_PAYMENTS', mainVoting.address)
      await checkRole(finance.address, await finance.MANAGE_PAYMENTS_ROLE(), mainVoting.address, 'Finance', 'MANAGE_PAYMENTS', mainVoting.address)

      // General Memebership TokenManager
      // TODO
      // MTC TokenManager
      // TODO

      // General Memebership Voting
      await checkRole(mainVoting.address, await mainVoting.CREATE_VOTES_ROLE(), mainVoting.address, 'MainVoting', 'CREATE_VOTES', mainTokenManager.address)
      await checkRole(mainVoting.address, await mainVoting.MODIFY_QUORUM_ROLE(), mainVoting.address, 'MainVoting', 'MODIFY_QUORUM')
      await checkRole(mainVoting.address, await mainVoting.MODIFY_SUPPORT_ROLE(), mainVoting.address, 'MainVoting', 'MODIFY_SUPPORT')

      // Supermajority voting
      await checkRole(supermajorityVoting.address, await supermajorityVoting.CREATE_VOTES_ROLE(), supermajorityVoting.address, 'SupermajorityVoting', 'CREATE_VOTES', mainTokenManager.address)
      await checkRole(supermajorityVoting.address, await supermajorityVoting.MODIFY_QUORUM_ROLE(), supermajorityVoting.address, 'SupermajorityVoting', 'MODIFY_QUORUM')
      await checkRole(supermajorityVoting.address, await supermajorityVoting.MODIFY_SUPPORT_ROLE(), supermajorityVoting.address, 'SupermajorityVoting', 'MODIFY_SUPPORT')

      // MTC Voting
      await checkRole(mtcVoting.address, await mtcVoting.CREATE_VOTES_ROLE(), mtcVoting.address, 'MtcVoting', 'CREATE_VOTES', mtcTokenManager.address)
      await checkRole(mtcVoting.address, await mtcVoting.MODIFY_QUORUM_ROLE(), mtcVoting.address, 'MtcVoting', 'MODIFY_QUORUM')
      await checkRole(mtcVoting.address, await mtcVoting.MODIFY_SUPPORT_ROLE(), mtcVoting.address, 'MtcVoting', 'MODIFY_SUPPORT')
    })

    for (const votingType of ['Main', 'Supermajority', 'MTC']) {
      let apps = {}
      apps['Main'] = mainVoting
      apps['Supermajority'] = supermajorityVoting
      apps['MTC'] = mtcVoting

      context(`creating ${votingType} vote`, () => {
        let votingApp, voteId = {}
        let executionTarget = {}, script

        beforeEach(async () => {
          votingApp = apps[votingType]
          executionTarget = await getContract('ExecutionTarget').new()
          const action = { to: executionTarget.address, calldata: executionTarget.contract.execute.getData() }
          script = encodeCallScript([action, action])
          voteId = createdVoteId(await votingApp.newVote(script, 'metadata', { from: owner }))
        })

        it('has correct state', async() => {
          const [isOpen, isExecuted, startDate, snapshotBlock, requiredSupport, minQuorum, y, n, totalVoters, execScript] = await votingApp.getVote(voteId)

          assert.isTrue(isOpen, 'vote should be open')
          assert.isFalse(isExecuted, 'vote should be executed')
          assert.equal(snapshotBlock.toString(), await getBlockNumber() - 1, 'snapshot block should be correct')
          assert.equal(requiredSupport.toString(), (votingType == 'Supermajority') ? NEEDED_SUPPORT_SUPERMAJORITY.toString() : NEEDED_SUPPORT.toString(), 'min quorum should be app min quorum')
          assert.equal(minQuorum.toString(), MINIMUM_ACCEPTANCE_QUORUM.toString(), 'min quorum should be app min quorum')
          assert.equal(y, 0, 'initial yea should be 0')
          assert.equal(n, 0, 'initial nay should be 0')
          assert.equal(totalVoters.toString(), new web3.BigNumber(100e18).toString(), 'total voters should be 100')
          assert.equal(execScript, script, 'script should be correct')
        })

        it('holder can vote', async () => {
          await votingApp.vote(voteId, false, true, { from: holder33 })
          const state = await votingApp.getVote(voteId)

          assert.equal(state[7].toString(), new web3.BigNumber(33e18).toString(), 'nay vote should have been counted')
        })

        it('holder can modify vote', async () => {
          await votingApp.vote(voteId, true, true, { from: holder33 })
          await votingApp.vote(voteId, false, true, { from: holder33 })
          await votingApp.vote(voteId, true, true, { from: holder33 })
          const state = await votingApp.getVote(voteId)

          assert.equal(state[6].toString(), new web3.BigNumber(33e18).toString(), 'yea vote should have been counted')
          assert.equal(state[7], 0, 'nay vote should have been removed')
        })

        it('throws when non-holder votes', async () => {
          return assertRevert(async () => {
            await votingApp.vote(voteId, true, true, { from: nonHolder })
          })
        })

        it('throws when voting after voting closes', async () => {
          await timeTravel(VOTING_TIME + 1)
          return assertRevert(async () => {
            await votingApp.vote(voteId, true, true, { from: holder33 })
          })
        })

        it('can execute if vote is approved with support and quorum', async () => {
          await votingApp.vote(voteId, true, true, { from: holder33 })
          await votingApp.vote(voteId, false, true, { from: holder16 })
          await timeTravel(VOTING_TIME + 1)
          await votingApp.executeVote(voteId, {from: owner})
          assert.equal((await executionTarget.counter()).toString(), 2, 'should have executed result')
        })

        it('cannot execute vote if not enough quorum met', async () => {
          await timeTravel(VOTING_TIME + 1)
          return assertRevert(async () => {
            await votingApp.executeVote(voteId, {from: owner})
          })
        })

        it('cannot execute vote if not support met', async () => {
          await votingApp.vote(voteId, false, true, { from: holder33 })
          await votingApp.vote(voteId, false, true, { from: holder16 })
          await timeTravel(VOTING_TIME + 1)
          return assertRevert(async () => {
            await votingApp.executeVote(voteId, {from: owner})
          })
        })

        it('nobody else can create votes', async () => {
          return assertRevert(async () => {
            await votingApp.newVote(script, 'metadata', { from: holder51 })
          })
        })
      })
    }
  })

  context('finance access', () => {
    let voteId = {}, script
    const payment = new web3.BigNumber(2e16)
    beforeEach(async () => {
      // Fund Finance
      await finance.sendTransaction({ value: payment, from: owner })
      const action = { to: finance.address, calldata: finance.contract.newPayment.getData(ETH, nonHolder, payment, 0, 0, 1, "voting payment") }
      script = encodeCallScript([action])
      voteId = createdVoteId(await mainVoting.newVote(script, 'metadata', { from: owner }))
    })

    it('finance can not be accessed directly (without a vote)', async () => {
      return assertRevert(async () => {
        await finance.newPayment(ETH, nonHolder, 2e16, 0, 0, 1, "voting payment")
      })
    })

    it('transfers funds if vote is approved', async () => {
      const receiverInitialBalance = await getBalance(nonHolder)
      //await logBalances(finance.address, vault.address)
      await mainVoting.vote(voteId, true, true, { from: holder33 })
      await mainVoting.vote(voteId, false, true, { from: holder16 })
      await timeTravel(VOTING_TIME + 1)
      await mainVoting.executeVote(voteId, {from: owner})
      //await logBalances(finance.address, vault.address)
      assert.equal((await getBalance(nonHolder)).toString(), receiverInitialBalance.plus(payment).toString(), 'Receiver didn\'t get the payment')
    })
  })

  const logBalances = async(financeProxyAddress, vaultProxyAddress) => {
    console.log('Owner ETH: ' + await getBalance(owner))
    console.log('Finance ETH: ' + await getBalance(financeProxyAddress))
    console.log('Vault ETH: ' + await getBalance(vaultProxyAddress))
    console.log('Receiver ETH: ' + await getBalance(nonHolder))
    console.log('-----------------')
  }
})