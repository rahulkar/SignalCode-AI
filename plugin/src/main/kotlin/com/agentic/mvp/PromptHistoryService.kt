package com.signalcode.mvp

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@Service(Service.Level.APP)
@State(name = "SignalCodePromptHistory", storages = [Storage("signalcode-ai.xml")])
class PromptHistoryService : PersistentStateComponent<PromptHistoryService.State> {
    data class State(
        var prompts: MutableList<String> = mutableListOf(),
        var selectedModel: String? = null
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    fun recent(max: Int): List<String> = state.prompts.take(max)

    fun remember(prompt: String, max: Int) {
        val clean = prompt.trim()
        if (clean.isEmpty()) {
            return
        }
        state.prompts.remove(clean)
        state.prompts.add(0, clean)
        if (state.prompts.size > max) {
            state.prompts.subList(max, state.prompts.size).clear()
        }
    }

    fun clear() {
        state.prompts.clear()
    }

    fun selectedModel(defaultModel: String): String = state.selectedModel ?: defaultModel

    fun setSelectedModel(model: String) {
        state.selectedModel = model
    }
}
