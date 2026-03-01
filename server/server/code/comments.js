/*
    ######################################################################
    WebSync Live - copyright (c) 2026 MazyLawzey
    https://github.com/MazyLawzey - MazyLawzey main author of WebSync Live
    https://github.com/rionn11 - rionn11 main contributor of WebSync Live
    https://github.com/MazyLawzey/websync-live - OUR REPO
    GPL-3.0 license
    #######################################################################
*/

/**
 * In-memory comment store for a session.
 * Each comment has: id, filePath, line, text, author, authorId, createdAt
 */
class CommentStore {
    constructor() {
        this.comments = [];
    }

    /**
     * Add a comment to the store
     * @param {Object} comment - The comment object
     * @returns {Object} The added comment
     */
    add(comment) {
        this.comments.push(comment);
        return comment;
    }

    /**
     * Delete a comment by ID
     * @param {string} commentId
     * @returns {boolean} Whether the comment was found and deleted
     */
    delete(commentId) {
        const index = this.comments.findIndex(c => c.id === commentId);
        if (index !== -1) {
            this.comments.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Find a comment by ID
     * @param {string} commentId
     * @returns {Object|undefined}
     */
    findById(commentId) {
        return this.comments.find(c => c.id === commentId);
    }

    /**
     * Get all comments for a specific file
     * @param {string} filePath
     * @returns {Object[]}
     */
    getByFile(filePath) {
        return this.comments.filter(c => c.filePath === filePath);
    }

    /**
     * Get all comments
     * @returns {Object[]}
     */
    getAll() {
        return [...this.comments];
    }

    /**
     * Clear all comments
     */
    clear() {
        this.comments = [];
    }
}

module.exports = { CommentStore };
