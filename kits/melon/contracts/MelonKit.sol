pragma solidity 0.4.24;

import "@aragon/apps-agent/contracts/Agent.sol";
import "@aragon/apps-finance/contracts/Finance.sol";
import "@aragon/apps-token-manager/contracts/TokenManager.sol";
import "@aragon/apps-vault/contracts/Vault.sol";
import "@aragon/apps-voting/contracts/Voting.sol";
import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";

import "@aragon/os/contracts/apm/APMNamehash.sol";
import "@aragon/os/contracts/common/IsContract.sol";

import "@aragon/kits-base/contracts/KitBase.sol";


contract MelonKit is KitBase, APMNamehash, IsContract {

    string constant private MAIN_TOKEN_SYMBOL = "MGM";
    string constant private MAIN_TOKEN_NAME = "Melon General Membership";
    string constant private MTC_TOKEN_SYMBOL = "MTC";
    string constant private MTC_TOKEN_NAME = "Melon Technical Council";

    uint64 constant public MAIN_VOTING_SUPPORT = 50 * 10**16; // support not relevant here
    uint64 constant public MAIN_VOTING_QUORUM = 50 * 10**16; // > 50%
    uint64 constant public MAIN_VOTING_VOTE_TIME = 2 weeks;

    uint64 constant public SUPERMAJORITY_VOTING_SUPPORT = 666666666666666666; // support not relevant here
    uint64 constant public SUPERMAJORITY_VOTING_QUORUM = 666666666666666666; // >2/3
    uint64 constant public SUPERMAJORITY_VOTING_VOTE_TIME = 2 weeks;

    uint64 constant public MTC_VOTING_SUPPORT = 50 * 10**16; // support not relevant here
    uint64 constant public MTC_VOTING_QUORUM = 50 * 10**16; // > 50%
    uint64 constant public MTC_VOTING_VOTE_TIME = 2 weeks;

    uint64 constant public FINANCE_PERIOD_DURATION = 7889400; // 365.25 days / 4

    bytes32 constant public agentAppId = apmNamehash("agent");
    bytes32 constant public financeAppId = apmNamehash("finance");
    bytes32 constant public tokenManagerAppId = apmNamehash("token-manager");
    bytes32 constant public vaultAppId = apmNamehash("vault");
    bytes32 constant public votingAppId = apmNamehash("voting");

    MiniMeTokenFactory public minimeFac;
    mapping (address => address) private daoCreator;

    event DeployToken(address token);

    constructor(
        DAOFactory _fac,
        ENS _ens,
        MiniMeTokenFactory _minimeFac
    )
        KitBase(_fac, _ens)
        public
    {
        require(isContract(address(_fac.regFactory())));

        minimeFac = _minimeFac;
    }

    function newInstance1WithVotingTimes(
        address[] mebMembers,
        address[] mtcMembers,
        uint64 mainVotingVoteTime,
        uint64 supermajorityVotingVoteTime
    ) public {
        Kernel dao = fac.newDAO(this);
        ACL acl = ACL(dao.acl());

        acl.createPermission(this, dao, dao.APP_MANAGER_ROLE(), this);

        Vault vault = Vault(
            dao.newAppInstance(
                vaultAppId,
                latestVersionAppBase(vaultAppId),
                new bytes(0),
                true
            )
        );
        emit InstalledApp(vault, vaultAppId);

        Finance finance = Finance(dao.newAppInstance(financeAppId, latestVersionAppBase(financeAppId)));
        emit InstalledApp(finance, financeAppId);

        MiniMeToken mainToken = minimeFac.createCloneToken(
            MiniMeToken(address(0)),
            0,
            MAIN_TOKEN_NAME,
            0,
            MAIN_TOKEN_SYMBOL,
            true
        );
        emit DeployToken(mainToken);

        TokenManager mainTokenManager = TokenManager(
            dao.newAppInstance(
                tokenManagerAppId,
                latestVersionAppBase(tokenManagerAppId)
            )
        );
        emit InstalledApp(mainTokenManager, tokenManagerAppId);

        Voting mainVoting = Voting(dao.newAppInstance(votingAppId, latestVersionAppBase(votingAppId)));
        emit InstalledApp(mainVoting, votingAppId);

        Voting supermajorityVoting = Voting(dao.newAppInstance(votingAppId, latestVersionAppBase(votingAppId)));
        emit InstalledApp(supermajorityVoting, votingAppId);

        // permissions
        // Vault
        acl.createPermission(finance, vault, vault.TRANSFER_ROLE(), mainVoting);
        // Finance
        acl.createPermission(mainVoting, finance, finance.CREATE_PAYMENTS_ROLE(), mainVoting);
        acl.createPermission(mainVoting, finance, finance.EXECUTE_PAYMENTS_ROLE(), mainVoting);
        acl.createPermission(mainVoting, finance, finance.MANAGE_PAYMENTS_ROLE(), mainVoting);

        // General Membership Token Manager
        acl.createPermission(mainVoting, mainTokenManager, mainTokenManager.ISSUE_ROLE(), mainVoting);
        acl.createPermission(mainVoting, mainTokenManager, mainTokenManager.ASSIGN_ROLE(), mainVoting);
        acl.createPermission(mainVoting, mainTokenManager, mainTokenManager.BURN_ROLE(), mainVoting);

        // General Voting
        acl.createPermission(mainTokenManager, mainVoting, mainVoting.CREATE_VOTES_ROLE(), mainVoting);
        acl.createPermission(mainVoting, mainVoting, mainVoting.MODIFY_QUORUM_ROLE(), mainVoting);
        acl.createPermission(mainVoting, mainVoting, mainVoting.MODIFY_SUPPORT_ROLE(), mainVoting);

        // Supermajority Voting permissions (more in next tx to balance gas)
        acl.createPermission(mainTokenManager, supermajorityVoting, supermajorityVoting.CREATE_VOTES_ROLE(), supermajorityVoting);

        // Required for initializing the Token Manager
        mainToken.changeController(mainTokenManager);

        // App inits
        vault.initialize();
        finance.initialize(vault, FINANCE_PERIOD_DURATION);
        mainTokenManager.initialize(mainToken, false, 1);
        mainVoting.initialize(mainToken, MAIN_VOTING_SUPPORT, MAIN_VOTING_QUORUM, mainVotingVoteTime);
        supermajorityVoting.initialize(mainToken, SUPERMAJORITY_VOTING_SUPPORT, SUPERMAJORITY_VOTING_QUORUM, supermajorityVotingVoteTime);

        // Set up the token members
        acl.createPermission(this, mainTokenManager, mainTokenManager.MINT_ROLE(), this);

        uint256 i;
        for (i = 0; i < mebMembers.length; i++) {
            mainTokenManager.mint(mebMembers[i], 1);
        }
        for (i = 0; i < mtcMembers.length; i++) {
            mainTokenManager.mint(mtcMembers[i], 1);
        }
        cleanupPermission(acl, mainVoting, mainTokenManager, mainTokenManager.MINT_ROLE());

        // register dao creator
        daoCreator[address(dao)] = msg.sender;

        emit DeployInstance(dao);
    }

    function newInstance1(address[] mebMembers, address[] mtcMembers) external {
        newInstance1WithVotingTimes(mebMembers, mtcMembers, MAIN_VOTING_VOTE_TIME, SUPERMAJORITY_VOTING_VOTE_TIME);
    }

    function newInstance2(Kernel dao, Voting mainVoting, Voting supermajorityVoting, address[] mtcMembers) external {
        // ensure sender is the same as in newIsntance1
        require(msg.sender == daoCreator[address(dao)]);

        ACL acl = ACL(dao.acl());

        // Supermajority Voting permissions (here to balance gas among transactions)
        acl.createPermission(supermajorityVoting, supermajorityVoting, supermajorityVoting.MODIFY_QUORUM_ROLE(), supermajorityVoting);
        acl.createPermission(supermajorityVoting, supermajorityVoting, supermajorityVoting.MODIFY_SUPPORT_ROLE(), supermajorityVoting);

        Voting mtcVoting = Voting(dao.newAppInstance(votingAppId, latestVersionAppBase(votingAppId)));
        emit InstalledApp(mtcVoting, votingAppId);

        MiniMeToken mtcToken = minimeFac.createCloneToken(
            MiniMeToken(address(0)),
            0,
            MTC_TOKEN_NAME,
            0,
            MTC_TOKEN_SYMBOL,
            true
        );
        emit DeployToken(mtcToken);

        TokenManager mtcTokenManager = TokenManager(
            dao.newAppInstance(
                tokenManagerAppId,
                latestVersionAppBase(tokenManagerAppId)
            )
        );
        emit InstalledApp(mtcTokenManager, tokenManagerAppId);

        // permissions
        // MTC Voting
        acl.createPermission(mtcTokenManager, mtcVoting, mtcVoting.CREATE_VOTES_ROLE(), mtcVoting);
        acl.createPermission(mtcVoting, mtcVoting, mtcVoting.MODIFY_QUORUM_ROLE(), mtcVoting);
        acl.createPermission(mtcVoting, mtcVoting, mtcVoting.MODIFY_SUPPORT_ROLE(), mtcVoting);

        // MTC Token Manager
        acl.createPermission(supermajorityVoting, mtcTokenManager, mtcTokenManager.ISSUE_ROLE(), supermajorityVoting);
        acl.createPermission(supermajorityVoting, mtcTokenManager, mtcTokenManager.ASSIGN_ROLE(), supermajorityVoting);
        acl.createPermission(supermajorityVoting, mtcTokenManager, mtcTokenManager.BURN_ROLE(), supermajorityVoting);

        // Required for initializing the Token Manager
        mtcToken.changeController(mtcTokenManager);

        mtcTokenManager.initialize(mtcToken, false, 1);
        mtcVoting.initialize(mtcToken, MTC_VOTING_SUPPORT, MTC_VOTING_QUORUM, MTC_VOTING_VOTE_TIME);

        // Set up the token members
        acl.createPermission(this, mtcTokenManager, mtcTokenManager.MINT_ROLE(), this);

        for (uint256 i = 0; i < mtcMembers.length; i++) {
            mtcTokenManager.mint(mtcMembers[i], 1);
        }
        cleanupPermission(acl, supermajorityVoting, mtcTokenManager, mtcTokenManager.MINT_ROLE());

        // Agent apps
        Agent protocolAgent = Agent(dao.newAppInstance(agentAppId, latestVersionAppBase(agentAppId)));
        emit InstalledApp(protocolAgent, agentAppId);

        Agent technicalAgent = Agent(dao.newAppInstance(agentAppId, latestVersionAppBase(agentAppId)));
        emit InstalledApp(technicalAgent, agentAppId);

        acl.createPermission(mainVoting, protocolAgent, protocolAgent.EXECUTE_ROLE(), mainVoting);
        acl.createPermission(mtcVoting, technicalAgent, technicalAgent.EXECUTE_ROLE(), mtcVoting);

        // cleanup
        cleanupDAOPermissions(dao, acl, mainVoting);
    }
}
