Feature: The Plane plugin on the dashboard
  Once the plugin is activated and installed, the sites folders offer the Plane builder, each AI folder lists the
  items of its kind the plugin ships, the Plugins page lists the plugin with its settings, and the project rows of
  sites and code folders carry the PLANE menu of work items once a Plane is connected.

  # Settings lists every plugin that was added; the package and what the plugin ships are on its own page.
  Scenario: Settings lists the plugin, and its own page names its package, what it ships and its settings
    Given I am on "/settings"
     Then I should see "Plane"
     When I go to "/settings/plugin/plane"
     Then I should see "@webship.co/workspace-plane"
      And I should see "cmd-plane-project.sh"
      And I should see "plane-site-builder"
      And I should see "Writes to Plane (work items)"

  Scenario: A sites folder offers the Plane builder
    Given I am on "/dev"
     Then "option[value='cmd-plane-project.sh']" should be attached

  # The AI folders are searched by name: with every plugin on, a folder lists more than one page of items.
  Scenario: The AI Agents folder lists the agents the plugin ships
    Given I am on "/ai-agents?q=plane-"
     Then I should see "plane-site-builder"
      And I should see "plane-tester"
      And I should see "plane-issue-worker"

  Scenario: The AI Skills folder lists the skill the plugin ships
    Given I am on "/ai-skills?q=plane-scenarios"
     Then I should see "plane-scenarios"

  Scenario: The AI Commands folder lists the command the plugin ships
    Given I am on "/ai-commands?q=plane-test"
     Then I should see "plane-test"

  Scenario: The AI Prompts folder lists the prompts the plugin ships
    Given I am on "/ai-prompts?q=plane-"
     Then I should see "plane-build-and-test"
      And I should see "plane-issue-to-branch"

  # The work items as work items (@webship.co/workspace-tracker). The list asks Plane again when its View or its
  # filter changes, and Enter submits it. It needs a Plane with a key, a default project and a project in the dev
  # folder: CI has none, so it skips this, saying why.
  @needs-setting-plane-token @needs-setting-plane-default_scope @needs-project-dev
  Scenario: The work item list follows its View and its filter
    Given I am on "/dev"
     When I click on the element ".act-menu-plane > button"
      And I click on the element ".act-menu-plane a[hx-get*='/tracker/list/']"
     Then eventually I should see "All open work items ·" within 30 seconds
     When I select "Current cycle" from "view"
     Then eventually I should see "Current cycle ·" within 30 seconds
     When I fill in "q" with "WEB-1"
      And I press the key "Enter" on the element "input[name=q]"
     Then eventually I should see "Plane work item WEB-1 ·" within 30 seconds
