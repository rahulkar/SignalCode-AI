package com.signalcode.mvp

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RequestVersionTrackerTest {
    @Test
    fun stale_response_is_ignored_after_newer_request() {
        val tracker = RequestVersionTracker()
        val first = tracker.next()
        val second = tracker.next()

        assertFalse(tracker.isCurrent(first))
        assertTrue(tracker.isCurrent(second))
    }
}
