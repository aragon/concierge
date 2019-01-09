pragma solidity 0.4.24;

import "@aragon/apps-finance/contracts/Finance.sol";
import "@aragon/apps-token-manager/contracts/TokenManager.sol";
import "@aragon/apps-vault/contracts/Vault.sol";
import "@aragon/apps-voting/contracts/Voting.sol";
import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";

import "@aragon/id/contracts/IFIFSResolvingRegistrar.sol";

import "@aragon/os/contracts/apm/APMNamehash.sol";
import "@aragon/os/contracts/common/IsContract.sol";

import "@aragon/kits-base/contracts/KitBase.sol";


contract MelonKit is KitBase, APMNamehash, IsContract {

    string constant private MAIN_TOKEN_SYMBOL = "MGM";
    string constant private MAIN_TOKEN_NAME = "Melon General Membership";
    string constant private MTC_TOKEN_SYMBOL = "MTC";
    string constant private MTC_TOKEN_NAME = "Melon Technical Council";

    uint64 constant public MAIN_VOTING_SUPPORT = 50 * 10**16; // > 50%
    uint64 constant public MAIN_VOTING_QUORUM = 0; // Just 1 vote is enough
    uint64 constant public MAIN_VOTING_VOTE_TIME = 48 hours;

    uint64 constant public SUPERMAJORITY_VOTING_SUPPORT = 666666666666666666; // > two thirds
    uint64 constant public SUPERMAJORITY_VOTING_QUORUM = 0; // Just 1 vote is enough
    uint64 constant public SUPERMAJORITY_VOTING_VOTE_TIME = 48 hours;

    uint64 constant public MTC_VOTING_SUPPORT = 50 * 10**16; // > 50%
    uint64 constant public MTC_VOTING_QUORUM = 0; // Just 1 vote is enough
    uint64 constant public MTC_VOTING_VOTE_TIME = 48 hours;

    uint64 constant public FINANCE_PERIOD_DURATION = 7889400; // 365.25 days / 4

    bytes32 constant public actorAppId = apmNamehash("actor");
    bytes32 constant public financeAppId = apmNamehash("finance");
    bytes32 constant public tokenManagerAppId = apmNamehash("token-manager");
    bytes32 constant public vaultAppId = apmNamehash("vault");
    bytes32 constant public votingAppId = apmNamehash("voting");

    MiniMeTokenFactory public minimeFac;
    IFIFSResolvingRegistrar public aragonID;

    event DeployToken(address token);

    constructor(
        DAOFactory _fac,
        ENS _ens,
        MiniMeTokenFactory _minimeFac,
        IFIFSResolvingRegistrar _aragonID
    )
        KitBase(_fac, _ens)
        public
    {
        require(isContract(address(_fac.regFactory())));

        minimeFac = _minimeFac;
        aragonID = _aragonID;
    }

    function newInstance(/* string name,  */address[] mebMembers, address[] mtcMembers) external returns (Kernel) {
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
        acl.createPermission(mainVoting, mainTokenManager, mainTokenManager.ASSIGN_ROLE(), mainVoting);
        acl.createPermission(mainVoting, mainTokenManager, mainTokenManager.REVOKE_VESTINGS_ROLE(), mainVoting);

        // General Voting
        acl.createPermission(mainTokenManager, mainVoting, mainVoting.CREATE_VOTES_ROLE(), mainVoting);
        acl.createPermission(supermajorityVoting, mainVoting, mainVoting.MODIFY_QUORUM_ROLE(), supermajorityVoting);
        acl.createPermission(supermajorityVoting, mainVoting, mainVoting.MODIFY_SUPPORT_ROLE(), supermajorityVoting);

        // Supermajority Voting
        acl.createPermission(mainTokenManager, supermajorityVoting, supermajorityVoting.CREATE_VOTES_ROLE(), supermajorityVoting);
        acl.createPermission(supermajorityVoting, supermajorityVoting, supermajorityVoting.MODIFY_QUORUM_ROLE(), supermajorityVoting);
        acl.createPermission(supermajorityVoting, supermajorityVoting, supermajorityVoting.MODIFY_SUPPORT_ROLE(), supermajorityVoting);

        // Required for initializing the Token Manager
        mainToken.changeController(mainTokenManager);

        // App inits
        vault.initialize();
        finance.initialize(vault, FINANCE_PERIOD_DURATION);
        mainTokenManager.initialize(mainToken, false, 1);
        mainVoting.initialize(mainToken, MAIN_VOTING_SUPPORT, MAIN_VOTING_QUORUM, MAIN_VOTING_VOTE_TIME);
        supermajorityVoting.initialize(mainToken, SUPERMAJORITY_VOTING_SUPPORT, SUPERMAJORITY_VOTING_QUORUM, SUPERMAJORITY_VOTING_VOTE_TIME);

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

        // Set up MTC
        setUpMTC(dao, acl, mtcMembers);

        // cleanup
        cleanupDAOPermissions(dao, acl, mainVoting);

        // register Aragon ID
        //aragonID.register(keccak256(abi.encodePacked(name)), dao);

        emit DeployInstance(dao);

        return dao;
    }

    function setUpMTC(Kernel dao, ACL acl, address[] mtcMembers) internal {
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
        acl.createPermission(mtcVoting, mtcTokenManager, mtcTokenManager.ASSIGN_ROLE(), mtcVoting);
        acl.createPermission(mtcVoting, mtcTokenManager, mtcTokenManager.REVOKE_VESTINGS_ROLE(), mtcVoting);

        // Required for initializing the Token Manager
        mtcToken.changeController(mtcTokenManager);

        mtcTokenManager.initialize(mtcToken, false, 1);
        mtcVoting.initialize(mtcToken, MTC_VOTING_SUPPORT, MTC_VOTING_QUORUM, MTC_VOTING_VOTE_TIME);

        // Set up the token members
        acl.createPermission(this, mtcTokenManager, mtcTokenManager.MINT_ROLE(), this);

        for (uint256 i = 0; i < mtcMembers.length; i++) {
            mtcTokenManager.mint(mtcMembers[i], 1);
        }
        cleanupPermission(acl, mtcVoting, mtcTokenManager, mtcTokenManager.MINT_ROLE());
    }
}