codeunit 80020 "CG-AL-M010 Test"
{
    // Tests for CG-AL-M010: Multi-Object Project Management System
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        ProjectCounter: Integer;

    [Test]
    procedure TestProjectTableHasRequiredFields()
    var
        Project: Record Project;
    begin
        // [SCENARIO] Project table has all required fields
        // [GIVEN] The Project table definition
        // [WHEN] We initialize a record and set all required fields
        Project.Init();
        Project."Project Code" := 'PROJ001';
        Project.Name := 'Test Project Name';
        Project."Start Date" := WorkDate();
        Project."End Date" := WorkDate() + 30;
        Project.Status := Project.Status::Planning;
        Project."Budget Amount" := 10000.00;

        // [THEN] All fields can be assigned without error
        Assert.AreEqual('PROJ001', Project."Project Code", 'Project Code field should exist');
        Assert.AreEqual('Test Project Name', Project.Name, 'Name field should exist');
        Assert.AreEqual(WorkDate(), Project."Start Date", 'Start Date field should exist');
        Assert.AreEqual(WorkDate() + 30, Project."End Date", 'End Date field should exist');
        Assert.AreEqual(Project.Status::Planning, Project.Status, 'Status field should exist');
        Assert.AreEqual(10000.00, Project."Budget Amount", 'Budget Amount field should exist');
    end;

    [Test]
    procedure TestProjectTaskTableHasRequiredFields()
    var
        ProjectTask: Record "Project Task";
    begin
        // [SCENARIO] Project Task table has all required fields
        // [GIVEN] The Project Task table definition
        // [WHEN] We initialize a record and set all required fields
        ProjectTask.Init();
        ProjectTask."Project Code" := 'PROJ001';
        ProjectTask."Task Code" := 'TASK001';
        ProjectTask.Description := 'Test Task Description';
        ProjectTask."Estimated Hours" := 40.0;
        ProjectTask."Actual Hours" := 35.5;
        ProjectTask."Hourly Rate" := 75.00;
        ProjectTask.Status := ProjectTask.Status::Open;

        // [THEN] All fields can be assigned without error
        Assert.AreEqual('PROJ001', ProjectTask."Project Code", 'Project Code field should exist');
        Assert.AreEqual('TASK001', ProjectTask."Task Code", 'Task Code field should exist');
        Assert.AreEqual('Test Task Description', ProjectTask.Description, 'Description field should exist');
        Assert.AreEqual(40.0, ProjectTask."Estimated Hours", 'Estimated Hours field should exist');
        Assert.AreEqual(35.5, ProjectTask."Actual Hours", 'Actual Hours field should exist');
        Assert.AreEqual(75.00, ProjectTask."Hourly Rate", 'Hourly Rate field should exist');
        Assert.AreEqual(ProjectTask.Status::Open, ProjectTask.Status, 'Status field should exist');
    end;

    [Test]
    procedure TestProjectStatusOptions()
    var
        Project: Record Project;
    begin
        // [SCENARIO] Project Status has all required options
        // [GIVEN] The Project table
        // [WHEN] We test all status options
        Project.Init();

        // [THEN] All status options exist
        Project.Status := Project.Status::Planning;
        Assert.AreEqual(Project.Status::Planning, Project.Status, 'Planning status should exist');

        Project.Status := Project.Status::Active;
        Assert.AreEqual(Project.Status::Active, Project.Status, 'Active status should exist');

        Project.Status := Project.Status::"On Hold";
        Assert.AreEqual(Project.Status::"On Hold", Project.Status, 'On Hold status should exist');

        Project.Status := Project.Status::Completed;
        Assert.AreEqual(Project.Status::Completed, Project.Status, 'Completed status should exist');
    end;

    [Test]
    procedure TestProjectTaskStatusOptions()
    var
        ProjectTask: Record "Project Task";
    begin
        // [SCENARIO] Project Task Status has all required options
        // [GIVEN] The Project Task table
        // [WHEN] We test all status options
        ProjectTask.Init();

        // [THEN] All status options exist
        ProjectTask.Status := ProjectTask.Status::Open;
        Assert.AreEqual(ProjectTask.Status::Open, ProjectTask.Status, 'Open status should exist');

        ProjectTask.Status := ProjectTask.Status::"In Progress";
        Assert.AreEqual(ProjectTask.Status::"In Progress", ProjectTask.Status, 'In Progress status should exist');

        ProjectTask.Status := ProjectTask.Status::Completed;
        Assert.AreEqual(ProjectTask.Status::Completed, ProjectTask.Status, 'Completed status should exist');
    end;

    [Test]
    procedure TestProjectCardPageExists()
    var
        ProjectCard: TestPage "Project Card";
    begin
        // [SCENARIO] Project Card page exists and can be opened
        // [WHEN] We open the page
        ProjectCard.OpenView();
        // [THEN] No error occurs
        ProjectCard.Close();
    end;

    [Test]
    procedure TestProjectManagementCodeunitExists()
    var
        ProjectManagement: Codeunit "Project Management";
    begin
        // [SCENARIO] Project Management codeunit exists
        // [GIVEN] The codeunit definition
        // [WHEN] We reference the codeunit
        // [THEN] No error occurs - codeunit is callable
        Assert.IsTrue(true, 'Project Management codeunit exists and can be referenced');
    end;

    [Test]
    procedure TestCreateProject()
    var
        Project: Record Project;
    begin
        // [SCENARIO] Project can be created with all fields
        // [GIVEN] Project data
        ProjectCounter += 1;
        Project.Init();
        Project."Project Code" := 'PROJ' + Format(ProjectCounter);
        Project.Name := 'Test Project';
        Project."Start Date" := WorkDate();
        Project."End Date" := WorkDate() + 90;
        Project.Status := Project.Status::Planning;
        Project."Budget Amount" := 50000.00;

        // [WHEN] We insert the project
        Project.Insert(true);

        // [THEN] Project is created with all fields preserved
        Assert.IsTrue(Project.Get(Project."Project Code"), 'Project should be created');
        Assert.AreEqual('Test Project', Project.Name, 'Name should be preserved');
        Assert.AreEqual(WorkDate(), Project."Start Date", 'Start Date should be preserved');
        Assert.AreEqual(WorkDate() + 90, Project."End Date", 'End Date should be preserved');
        Assert.AreEqual(50000.00, Project."Budget Amount", 'Budget Amount should be preserved');

        // Cleanup
        Project.Delete();
    end;

    [Test]
    procedure TestCreateProjectTask()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
    begin
        // [SCENARIO] Project Task can be created and linked to Project
        // [GIVEN] A project
        CreateTestProject(Project);

        // [WHEN] We create a task with all fields
        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'TASK001';
        ProjectTask.Description := 'Test Task';
        ProjectTask."Estimated Hours" := 16.0;
        ProjectTask."Actual Hours" := 12.5;
        ProjectTask."Hourly Rate" := 100.00;
        ProjectTask.Status := ProjectTask.Status::Open;
        ProjectTask.Insert(true);

        // [THEN] Task is linked to project and fields are preserved
        Assert.AreEqual(Project."Project Code", ProjectTask."Project Code", 'Task should be linked to project');
        Assert.AreEqual(16.0, ProjectTask."Estimated Hours", 'Estimated Hours should be preserved');
        Assert.AreEqual(12.5, ProjectTask."Actual Hours", 'Actual Hours should be preserved');
        Assert.AreEqual(100.00, ProjectTask."Hourly Rate", 'Hourly Rate should be preserved');

        // Cleanup
        ProjectTask.Delete();
        Project.Delete();
    end;

    [Test]
    procedure TestProjectTaskCompositeKey()
    var
        Project: Record Project;
        ProjectTask1: Record "Project Task";
        ProjectTask2: Record "Project Task";
    begin
        // [SCENARIO] Project Task uses composite primary key (Project Code + Task Code)
        // [GIVEN] A project
        CreateTestProject(Project);

        // [WHEN] We create multiple tasks with same task code but can get them by composite key
        ProjectTask1.Init();
        ProjectTask1."Project Code" := Project."Project Code";
        ProjectTask1."Task Code" := 'TASK001';
        ProjectTask1.Description := 'Task 1';
        ProjectTask1.Insert(true);

        ProjectTask2.Init();
        ProjectTask2."Project Code" := Project."Project Code";
        ProjectTask2."Task Code" := 'TASK002';
        ProjectTask2.Description := 'Task 2';
        ProjectTask2.Insert(true);

        // [THEN] Each task can be retrieved by composite key
        Assert.IsTrue(ProjectTask1.Get(Project."Project Code", 'TASK001'), 'Should get task by composite key');
        Assert.IsTrue(ProjectTask2.Get(Project."Project Code", 'TASK002'), 'Should get task by composite key');

        // Cleanup
        ProjectTask1.Delete();
        ProjectTask2.Delete();
        Project.Delete();
    end;

    [Test]
    procedure TestProjectTaskTableRelation()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
    begin
        // [SCENARIO] Project Task has table relation to Project
        // [GIVEN] A project
        CreateTestProject(Project);

        // [WHEN] We create a task linked to the project
        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'TASK001';
        ProjectTask.Description := 'Test Task';
        ProjectTask.Insert(true);

        // [THEN] Task is properly related to Project
        ProjectTask.SetRange("Project Code", Project."Project Code");
        Assert.AreEqual(1, ProjectTask.Count(), 'Task should be found by Project Code filter');

        // Cleanup
        ProjectTask.Delete();
        Project.Delete();
    end;

    [Test]
    procedure TestProjectTaskRelationshipMultipleTasks()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
        TaskCount: Integer;
    begin
        // [SCENARIO] Project can have multiple tasks
        // [GIVEN] A project with tasks
        CreateTestProject(Project);
        CreateTestTask(Project, ProjectTask, 1);
        CreateTestTask(Project, ProjectTask, 2);
        CreateTestTask(Project, ProjectTask, 3);

        // [WHEN] We count tasks
        ProjectTask.SetRange("Project Code", Project."Project Code");
        TaskCount := ProjectTask.Count();

        // [THEN] All tasks are linked
        Assert.AreEqual(3, TaskCount, 'Project should have 3 tasks');

        // Cleanup
        ProjectTask.DeleteAll();
        Project.Delete();
    end;

    [Test]
    procedure TestCalculateTotalEstimatedHours()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
        TotalHours: Decimal;
    begin
        // [SCENARIO] Project.CalculateTotalEstimatedHours returns sum of task estimated hours
        // [GIVEN] A project with tasks that have estimated hours
        CreateTestProject(Project);

        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'TASK1';
        ProjectTask.Description := 'Task 1';
        ProjectTask."Estimated Hours" := 10.5;
        ProjectTask.Insert(true);

        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'TASK2';
        ProjectTask.Description := 'Task 2';
        ProjectTask."Estimated Hours" := 20.25;
        ProjectTask.Insert(true);

        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'TASK3';
        ProjectTask.Description := 'Task 3';
        ProjectTask."Estimated Hours" := 15.0;
        ProjectTask.Insert(true);

        // [WHEN] We calculate total estimated hours
        Project.Get(Project."Project Code");
        TotalHours := Project.CalculateTotalEstimatedHours();

        // [THEN] Total is sum of task estimated hours (10.5 + 20.25 + 15.0 = 45.75)
        Assert.AreEqual(45.75, TotalHours, 'Total estimated hours should be 45.75');

        // Cleanup
        ProjectTask.SetRange("Project Code", Project."Project Code");
        ProjectTask.DeleteAll();
        Project.Delete();
    end;

    [Test]
    procedure TestCalculateTotalEstimatedHoursNoTasks()
    var
        Project: Record Project;
        TotalHours: Decimal;
    begin
        // [SCENARIO] Project.CalculateTotalEstimatedHours returns 0 when no tasks exist
        // [GIVEN] A project with no tasks
        CreateTestProject(Project);

        // [WHEN] We calculate total estimated hours
        Project.Get(Project."Project Code");
        TotalHours := Project.CalculateTotalEstimatedHours();

        // [THEN] Total is 0
        Assert.AreEqual(0, TotalHours, 'Total estimated hours should be 0 for project with no tasks');

        // Cleanup
        Project.Delete();
    end;

    [Test]
    procedure TestProjectCardDisplaysProjectData()
    var
        Project: Record Project;
        ProjectCard: TestPage "Project Card";
        ProjectCode: Code[20];
    begin
        // [SCENARIO] Project Card opens on a specific project record
        // [GIVEN] A project with data
        CreateTestProject(Project);
        Project.Name := 'Display Test Project';
        Project."Start Date" := WorkDate();
        Project."End Date" := WorkDate() + 60;
        Project."Budget Amount" := 25000.00;
        Project.Modify();
        ProjectCode := Project."Project Code";

        // [WHEN] We open Project Card and navigate to the record
        ProjectCard.OpenView();
        Assert.IsTrue(ProjectCard.GoToRecord(Project), 'Project Card should open on the created project');

        ProjectCard.Close();

        // [THEN] Underlying project still exists with correct data
        Assert.IsTrue(Project.Get(ProjectCode), 'Project should still exist after page open');
        Assert.AreEqual('Display Test Project', Project.Name, 'Project Name should be persisted');

        // Cleanup
        Project.Delete();
    end;

    [Test]
    procedure TestProjectManagementCreateProject()
    var
        Project: Record Project;
        ProjectManagement: Codeunit "Project Management";
        ProjectCode: Code[20];
        StartDate: Date;
    begin
        // [SCENARIO] Project Management.CreateProject creates a new project and returns the code
        // [GIVEN] Project name and start date
        StartDate := WorkDate();

        // [WHEN] We create via codeunit
        ProjectCode := ProjectManagement.CreateProject('New Project From Codeunit', StartDate);

        // [THEN] Project is created with correct values
        Assert.IsTrue(Project.Get(ProjectCode), 'Project should be created');
        Assert.AreNotEqual('', ProjectCode, 'Project Code should not be empty');
        Assert.AreEqual('New Project From Codeunit', Project.Name, 'Project name should match');
        Assert.AreEqual(StartDate, Project."Start Date", 'Start Date should be set');

        // Cleanup
        Project.Delete();
    end;

    [Test]
    procedure TestProjectManagementActivateProject()
    var
        Project: Record Project;
        ProjectManagement: Codeunit "Project Management";
    begin
        // [SCENARIO] Project Management.ActivateProject changes project status to Active
        // [GIVEN] A project in Planning status
        CreateTestProject(Project);
        Project.Status := Project.Status::Planning;
        Project.Modify();

        // [WHEN] We activate the project
        ProjectManagement.ActivateProject(Project."Project Code");

        // [THEN] Status is Active
        Project.Get(Project."Project Code");
        Assert.AreEqual(Project.Status::Active, Project.Status, 'Status should be Active after activation');

        // Cleanup
        Project.Delete();
    end;

    [Test]
    procedure TestProjectManagementCompleteProjectSuccess()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
        ProjectManagement: Codeunit "Project Management";
    begin
        // [SCENARIO] Project Management.CompleteProject succeeds when all tasks are completed
        // [GIVEN] A project with all tasks completed
        CreateTestProject(Project);
        Project.Status := Project.Status::Active;
        Project.Modify();

        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'TASK1';
        ProjectTask.Description := 'Completed Task';
        ProjectTask.Status := ProjectTask.Status::Completed;
        ProjectTask.Insert(true);

        // [WHEN] We complete the project
        ProjectManagement.CompleteProject(Project."Project Code");

        // [THEN] Project status is Completed
        Project.Get(Project."Project Code");
        Assert.AreEqual(Project.Status::Completed, Project.Status, 'Status should be Completed');

        // Cleanup
        ProjectTask.Delete();
        Project.Delete();
    end;

    [Test]
    procedure TestProjectCompleteWithOpenTasksFails()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
        ProjectManagement: Codeunit "Project Management";
    begin
        // [SCENARIO] Cannot complete project with open tasks
        // [GIVEN] A project with an incomplete task (Status::Open)
        CreateTestProject(Project);
        Project.Status := Project.Status::Active;
        Project.Modify();

        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'OPENTASK';
        ProjectTask.Description := 'Open Task';
        ProjectTask.Status := ProjectTask.Status::Open;
        ProjectTask.Insert(true);

        // [WHEN] We try to complete
        // [THEN] Error is raised
        asserterror ProjectManagement.CompleteProject(Project."Project Code");
        Assert.ExpectedError('Cannot complete project with open tasks');

        // Cleanup
        ProjectTask.Delete();
        Project.Delete();
    end;

    [Test]
    procedure TestProjectCompleteWithInProgressTasksFails()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
        ProjectManagement: Codeunit "Project Management";
    begin
        // [SCENARIO] Cannot complete project with in-progress tasks
        // [GIVEN] A project with an in-progress task
        CreateTestProject(Project);
        Project.Status := Project.Status::Active;
        Project.Modify();

        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'WIPTASK';
        ProjectTask.Description := 'In Progress Task';
        ProjectTask.Status := ProjectTask.Status::"In Progress";
        ProjectTask.Insert(true);

        // [WHEN] We try to complete
        // [THEN] Error is raised (open tasks includes in-progress)
        asserterror ProjectManagement.CompleteProject(Project."Project Code");

        // Cleanup
        ProjectTask.Delete();
        Project.Delete();
    end;

    [Test]
    procedure TestCascadeDeleteRemovesAllTasks()
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
        ProjectCode: Code[20];
    begin
        // [SCENARIO] Deleting project with Delete(true) deletes all related tasks
        // [GIVEN] A project with multiple tasks
        CreateTestProject(Project);
        ProjectCode := Project."Project Code";

        ProjectTask.Init();
        ProjectTask."Project Code" := ProjectCode;
        ProjectTask."Task Code" := 'TASK1';
        ProjectTask.Description := 'Task 1';
        ProjectTask.Insert(true);

        ProjectTask.Init();
        ProjectTask."Project Code" := ProjectCode;
        ProjectTask."Task Code" := 'TASK2';
        ProjectTask.Description := 'Task 2';
        ProjectTask.Insert(true);

        ProjectTask.Init();
        ProjectTask."Project Code" := ProjectCode;
        ProjectTask."Task Code" := 'TASK3';
        ProjectTask.Description := 'Task 3';
        ProjectTask.Insert(true);

        // Verify tasks exist before delete
        ProjectTask.SetRange("Project Code", ProjectCode);
        Assert.AreEqual(3, ProjectTask.Count(), 'Should have 3 tasks before delete');

        // [WHEN] We delete the project with trigger
        Project.Delete(true);

        // [THEN] All related tasks are also deleted
        ProjectTask.SetRange("Project Code", ProjectCode);
        Assert.AreEqual(0, ProjectTask.Count(), 'All tasks should be deleted after cascade delete');
    end;

    [Test]
    procedure TestCascadeDeleteWithNoTasks()
    var
        Project: Record Project;
        ProjectCode: Code[20];
    begin
        // [SCENARIO] Deleting project with no tasks succeeds
        // [GIVEN] A project with no tasks
        CreateTestProject(Project);
        ProjectCode := Project."Project Code";

        // [WHEN] We delete the project with trigger
        Project.Delete(true);

        // [THEN] No error occurs and project is deleted
        Assert.IsFalse(Project.Get(ProjectCode), 'Project should be deleted');
    end;

    local procedure CreateTestProject(var Project: Record Project)
    begin
        ProjectCounter += 1;
        Project.Init();
        Project."Project Code" := 'PROJ' + Format(ProjectCounter);
        Project.Name := 'Test Project';
        Project."Start Date" := WorkDate();
        Project."End Date" := WorkDate() + 30;
        Project.Status := Project.Status::Planning;
        Project."Budget Amount" := 10000.00;
        Project.Insert(true);
    end;

    local procedure CreateTestTask(var Project: Record Project; var ProjectTask: Record "Project Task"; Index: Integer)
    begin
        ProjectTask.Init();
        ProjectTask."Project Code" := Project."Project Code";
        ProjectTask."Task Code" := 'TASK' + Format(Index);
        ProjectTask.Description := 'Test Task';
        ProjectTask."Estimated Hours" := 8.0;
        ProjectTask."Actual Hours" := 0;
        ProjectTask."Hourly Rate" := 50.00;
        ProjectTask.Status := ProjectTask.Status::Open;
        ProjectTask.Insert(true);
    end;
}
