plugins {
    kotlin("jvm") version "2.1.21"
    id("org.jetbrains.intellij.platform") version "2.14.0"
}

group = "com.signalcode"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.1")
    }
    implementation("com.google.code.gson:gson:2.11.0")
    testImplementation(kotlin("test"))
}

intellijPlatform {
    // Avoids flaky :instrumentCode on Windows (META-INF locks under build/instrumented).
    // Safe here: no Swing UI forms; only JetBrains annotations on plain Kotlin.
    instrumentCode = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "241"
        }
    }
}

kotlin {
    jvmToolchain(17)
}
