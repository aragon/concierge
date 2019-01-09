# Melon Kit

## Using the Kit

### Dependencies
In order to use this kit, it must be run on a chain that has the following dependencies published.
- ENS
- APM
- A MiniMeToken (`ANT` for mainnet)
- `finance.aragonpm.eth`
- `token-manager.aragonpm.eth`
- `vault.aragonpm.eth`
- `voting.aragonpm.eth`

For local chains you can use `deploy:deps` scripts to deploy everything needed.

### Deploying the kit
Local development network:
```
npm run deploy:rpc
```
and:
```
npm run test:rpc
```

Rinkeby:
```
npm run deploy:rinkeby
```

## Permissions

TODO: Complete

| App     | Permission         | Grantee     | Manager     |
|---------|--------------------|-------------|-------------|
| Kernel  | APP_MANAGER        | Main Voting | Main Voting |
| ACL     | CREATE_PERMISSIONS | Main Voting | Main Voting |
| Vault   | TRANSFER           | Finance     | Main Voting |
| Finance | CREATE_PAYMENTS    | Main Voting | Main Voting |
| Finance | EXECUTE_PAYMENTS   | Main Voting | Main Voting |
| Finance | MANAGE_PAYMENTS    | Main Voting | Main Voting |
|         |                    |             |             |
