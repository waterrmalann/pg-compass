import { RolesChannels } from "../shared/constants/ipc-channels";
import { registerIpcHandler } from "./ipc-security";
import { clearAuditLog, getAuditLog } from "./audit-store";
import {
  buildSidebarSummary,
  buildSnapshot,
  getEffectivePermissions,
} from "./roles-queries";
import {
  alterRole,
  alterRoleComment,
  alterRolePassword,
  cloneRole,
  createRole,
  dropRole,
  grantMembership,
  renameRole,
  revokeMembership,
  runRoleMutation,
  setDbAccessLevel,
  setTableRestrictions,
} from "./roles-mutations";
import { listTriggers, setTriggerEnabled } from "./roles-triggers";
import {
  validateAlterRoleCommentInput,
  validateAlterRoleInput,
  validateAlterRolePasswordInput,
  validateCloneRoleInput,
  validateConnectionIdInput,
  validateConnectionUserInput,
  validateCreateRoleInput,
  validateDropRoleInput,
  validateMembershipInput,
  validateRenameRoleInput,
  validateRolesSnapshotInput,
  validateSetDbAccessLevelInput,
  validateSetTriggerEnabledInput,
  validateTableRestrictionInput,
  validateTriggerListInput,
} from "./ipc-validation";

export function registerRolesHandlers(): void {
  registerIpcHandler(
    RolesChannels.GET_SNAPSHOT,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateRolesSnapshotInput(rawInput);
        const data = await buildSnapshot(input.connectionId, input.targetUser);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GET_SIDEBAR_SUMMARY,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionIdInput(rawInput);
        const data = await buildSidebarSummary(input.connectionId);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CREATE_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateCreateRoleInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "create-role",
          `role "${input.name}"`,
          () => createRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.ALTER_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateAlterRoleInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "alter-role",
          `role "${input.name}"`,
          () => alterRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.ALTER_ROLE_PASSWORD,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateAlterRolePasswordInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "alter-role-password",
          `role "${input.name}"`,
          () => alterRolePassword(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.ALTER_ROLE_COMMENT,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateAlterRoleCommentInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "alter-role-comment",
          `role "${input.name}"`,
          () => alterRoleComment(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.DROP_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateDropRoleInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "drop-role",
          `role "${input.name}"`,
          () => dropRole(input.connectionId, input.name),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CLONE_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateCloneRoleInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "clone-role",
          `"${input.sourceName}" → "${input.newName}"`,
          () => cloneRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.RENAME_ROLE,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateRenameRoleInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "rename-role",
          `"${input.oldName}" → "${input.newName}"`,
          () => renameRole(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GRANT_MEMBERSHIP,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateMembershipInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "grant-membership",
          `"${input.memberName}" ← "${input.parentRoleName}"`,
          () => grantMembership(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.REVOKE_MEMBERSHIP,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateMembershipInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "revoke-membership",
          `"${input.memberName}" ← "${input.parentRoleName}"`,
          () => revokeMembership(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.SET_DB_ACCESS_LEVEL,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateSetDbAccessLevelInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "set-db-access-level",
          `user "${input.userName}", database "${input.databaseName}" → ${input.level}`,
          () => setDbAccessLevel(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.SET_TABLE_RESTRICTIONS,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateTableRestrictionInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          "set-table-restrictions",
          `user "${input.userName}", database "${input.databaseName}"`,
          () => setTableRestrictions(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.LIST_TRIGGERS,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateTriggerListInput(rawInput);
        const data = await listTriggers(input.connectionId, input.databaseName);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.SET_TRIGGER_ENABLED,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateSetTriggerEnabledInput(rawInput);
        return await runRoleMutation(
          input.connectionId,
          input.enabled ? "enable-trigger" : "disable-trigger",
          `${input.schemaName}.${input.tableName}.${input.triggerName}`,
          () => setTriggerEnabled(input),
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GET_EFFECTIVE_PERMISSIONS,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionUserInput(rawInput);
        const data = await getEffectivePermissions(
          input.connectionId,
          input.user,
        );
        return { success: true, data };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.GET_AUDIT_LOG,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionIdInput(rawInput);
        return { success: true, data: getAuditLog(input.connectionId) };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  registerIpcHandler(
    RolesChannels.CLEAR_AUDIT_LOG,
    async (_event, rawInput: unknown) => {
      try {
        const input = validateConnectionIdInput(rawInput);
        clearAuditLog(input.connectionId);
        return { success: true, data: undefined };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}
