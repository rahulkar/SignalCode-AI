package com.signalcode.mvp

import com.intellij.openapi.util.IconLoader
import javax.swing.Icon

object SignalCodeIcons {
    val Agent: Icon = IconLoader.getIcon("/META-INF/pluginIcon.svg", SignalCodeIcons::class.java)
    val Backend: Icon = IconLoader.getIcon("/icons/backend.svg", SignalCodeIcons::class.java)
    val ModeModel: Icon = IconLoader.getIcon("/icons/mode-model.svg", SignalCodeIcons::class.java)
    val Context: Icon = IconLoader.getIcon("/icons/context.svg", SignalCodeIcons::class.java)
    val Target: Icon = IconLoader.getIcon("/icons/target.svg", SignalCodeIcons::class.java)
    val Prompt: Icon = IconLoader.getIcon("/icons/prompt.svg", SignalCodeIcons::class.java)
    val History: Icon = IconLoader.getIcon("/icons/history.svg", SignalCodeIcons::class.java)
    val Demo: Icon = IconLoader.getIcon("/icons/demo.svg", SignalCodeIcons::class.java)
    val Inspect: Icon = IconLoader.getIcon("/icons/inspect.svg", SignalCodeIcons::class.java)
    val Patch: Icon = IconLoader.getIcon("/icons/patch.svg", SignalCodeIcons::class.java)
    val Test: Icon = IconLoader.getIcon("/icons/test.svg", SignalCodeIcons::class.java)
    val Dashboard: Icon = IconLoader.getIcon("/icons/dashboard.svg", SignalCodeIcons::class.java)
}
