package com.signalcode.mvp

/**
 * Tracks the latest generate request version so stale async responses can be ignored.
 */
class RequestVersionTracker {
    private var latestVersion: Long = 0

    fun next(): Long {
        latestVersion += 1
        return latestVersion
    }

    fun isCurrent(version: Long): Boolean = version == latestVersion
}
