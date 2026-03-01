/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

// Role definitions
const ROLES = {
    HOST: 'host',
    ADMIN: 'admin',
    EDITOR: 'editor',
    VIEWER: 'viewer'
};

// Role hierarchy (higher number = more authority)
const ROLE_HIERARCHY = {
    [ROLES.HOST]: 4,
    [ROLES.ADMIN]: 3,
    [ROLES.EDITOR]: 2,
    [ROLES.VIEWER]: 1
};

// All valid role values
const VALID_ROLES = Object.values(ROLES);

/**
 * Check if a role has edit permission
 * Host, Admin, and Editor can edit code
 */
function canEdit(role) {
    return [ROLES.HOST, ROLES.ADMIN, ROLES.EDITOR].includes(role);
}

/**
 * Check if a role can add comments
 * All roles can comment (including Viewer)
 */
function canComment(role) {
    return VALID_ROLES.includes(role);
}

/**
 * Check if a user with kickerRole can kick a user with targetRole
 * - Nobody can kick the Host
 * - Host can kick anyone
 * - Admin can kick Editor and Viewer
 * - Editor and Viewer cannot kick
 */
function canKick(kickerRole, targetRole) {
    if (targetRole === ROLES.HOST) return false;
    if (kickerRole === ROLES.HOST) return true;
    if (kickerRole === ROLES.ADMIN && ROLE_HIERARCHY[targetRole] < ROLE_HIERARCHY[ROLES.ADMIN]) return true;
    return false;
}

/**
 * Check if a user can change another user's role
 * - Cannot make anyone Host (host is not transferable)
 * - Cannot change Host's role
 * - Host can change anyone to Admin/Editor/Viewer
 * - Admin can change Editor/Viewer to Editor/Viewer (not to Admin)
 * - Editor and Viewer cannot change roles
 */
function canChangeRole(changerRole, targetCurrentRole, newRole) {
    if (newRole === ROLES.HOST) return false;
    if (targetCurrentRole === ROLES.HOST) return false;
    if (!VALID_ROLES.includes(newRole)) return false;

    if (changerRole === ROLES.HOST) return true;

    if (changerRole === ROLES.ADMIN) {
        return ROLE_HIERARCHY[targetCurrentRole] < ROLE_HIERARCHY[ROLES.ADMIN] &&
               ROLE_HIERARCHY[newRole] < ROLE_HIERARCHY[ROLES.ADMIN];
    }

    return false;
}

/**
 * Check if a role can manage the session (start/stop)
 * Only Host can manage the session
 */
function canManageSession(role) {
    return role === ROLES.HOST;
}

/**
 * Get a human-readable description of role permissions
 */
function getRoleDescription(role) {
    switch (role) {
        case ROLES.HOST:
            return 'Full control. Can edit, comment, manage users, and control the session.';
        case ROLES.ADMIN:
            return 'Can edit code, comment, kick editors/viewers, and change their roles.';
        case ROLES.EDITOR:
            return 'Can edit code and add comments.';
        case ROLES.VIEWER:
            return 'Can only view code and add comments.';
        default:
            return 'Unknown role.';
    }
}

module.exports = {
    ROLES,
    ROLE_HIERARCHY,
    VALID_ROLES,
    canEdit,
    canComment,
    canKick,
    canChangeRole,
    canManageSession,
    getRoleDescription
};
