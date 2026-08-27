codeunit 70005 "Project Management"
{
    procedure CreateProject(Name: Text[100]; StartDate: Date): Code[20]
    var
        Project: Record Project;
        NewProjectCode: Code[20];
    begin
        NewProjectCode := GetNextProjectCode();
        Project.Init();
        Project."Project Code" := NewProjectCode;
        Project.Name := Name;
        Project.Validate("Start Date", StartDate);
        Project.Status := Project.Status::Planning;
        Project.Insert(true);
        exit(NewProjectCode);
    end;

    procedure ActivateProject(ProjectCode: Code[20])
    var
        Project: Record Project;
    begin
        Project.Get(ProjectCode);
        Project.Validate(Status, Project.Status::Active);
        Project.Modify(true);
    end;

    procedure CompleteProject(ProjectCode: Code[20])
    var
        Project: Record Project;
        ProjectTask: Record "Project Task";
    begin
        Project.Get(ProjectCode);

        ProjectTask.SetRange("Project Code", ProjectCode);
        ProjectTask.SetFilter(Status, '<>%1', ProjectTask.Status::Completed);
        if not ProjectTask.IsEmpty() then
            Error(OpenTasksErr);

        Project.Validate(Status, Project.Status::Completed);
        if Project."End Date" = 0D then
            Project.Validate("End Date", WorkDate());
        Project.Modify(true);
    end;

    local procedure GetNextProjectCode(): Code[20]
    var
        Project: Record Project;
        LastNumber: Integer;
        NewCode: Code[20];
    begin
        Project.SetFilter("Project Code", 'PRJ*');
        if Project.FindLast() then
            if Evaluate(LastNumber, CopyStr(Project."Project Code", 4)) then;
        NewCode := CopyStr('PRJ' + Format(LastNumber + 1, 0, '<Integer,5><Filler Character,0>'), 1, MaxStrLen(NewCode));
        exit(NewCode);
    end;

    var
        OpenTasksErr: Label 'Cannot complete project with open tasks';
}
