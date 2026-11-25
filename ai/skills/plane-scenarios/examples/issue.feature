@work-items
Feature: A work item worked by a member
  Scenario: Its state, a comment and an assignee
    Given there is a work item "Webship test work" in the project "WEB"
    And I am a logged in user with the "member" user
    When I open the work item "Webship test work"
    And I set the state of the work item to "In Progress"
    And I add the comment "Checked on the test site" to the work item
    And I assign the work item to "owner"
    Then the state of the work item should be "In Progress"
    And the work item should show the comment "Checked on the test site" by "member"
    And the work item should be assigned to "owner"
