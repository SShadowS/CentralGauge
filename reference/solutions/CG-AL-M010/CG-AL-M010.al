table 70003 "Project"
{
    Caption = 'Project';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Project Code"; Code[20])
        {
            Caption = 'Project Code';
            DataClassification = CustomerContent;
            NotBlank = true;
        }
        field(2; Name; Text[100])
        {
            Caption = 'Name';
            DataClassification = CustomerContent;
        }
        field(3; "Start Date"; Date)
        {
            Caption = 'Start Date';
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                CheckDates();
            end;
        }
        field(4; "End Date"; Date)
        {
            Caption = 'End Date';
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                CheckDates();
            end;
        }
        field(5; Status; Option)
        {
            Caption = 'Status';
            DataClassification = CustomerContent;
            OptionMembers = Planning,Active,"On Hold",Completed;
            OptionCaption = 'Planning,Active,On Hold,Completed';
        }
        field(6; "Budget Amount"; Decimal)
        {
            Caption = 'Budget Amount';
            DataClassification = CustomerContent;
            MinValue = 0;
        }
    }

    keys
    {
        key(PK; "Project Code")
        {
            Clustered = true;
        }
    }

    trigger OnDelete()
    var
        ProjectTask: Record "Project Task";
    begin
        ProjectTask.SetRange("Project Code", "Project Code");
        ProjectTask.DeleteAll(true);
    end;

    procedure CalculateTotalEstimatedHours(): Decimal
    var
        ProjectTask: Record "Project Task";
    begin
        ProjectTask.SetRange("Project Code", "Project Code");
        ProjectTask.CalcSums("Estimated Hours");
        exit(ProjectTask."Estimated Hours");
    end;

    local procedure CheckDates()
    begin
        if ("Start Date" <> 0D) and ("End Date" <> 0D) then
            if "End Date" < "Start Date" then
                Error(EndDateBeforeStartDateErr);
    end;

    var
        EndDateBeforeStartDateErr: Label 'End Date cannot be earlier than Start Date.';
}

table 70004 "Project Task"
{
    Caption = 'Project Task';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Project Code"; Code[20])
        {
            Caption = 'Project Code';
            DataClassification = CustomerContent;
            NotBlank = true;
            TableRelation = Project."Project Code";
        }
        field(2; "Task Code"; Code[20])
        {
            Caption = 'Task Code';
            DataClassification = CustomerContent;
            NotBlank = true;
        }
        field(3; Description; Text[100])
        {
            Caption = 'Description';
            DataClassification = CustomerContent;
        }
        field(4; "Estimated Hours"; Decimal)
        {
            Caption = 'Estimated Hours';
            DataClassification = CustomerContent;
            MinValue = 0;
        }
        field(5; "Actual Hours"; Decimal)
        {
            Caption = 'Actual Hours';
            DataClassification = CustomerContent;
            MinValue = 0;
        }
        field(6; "Hourly Rate"; Decimal)
        {
            Caption = 'Hourly Rate';
            DataClassification = CustomerContent;
            MinValue = 0;
        }
        field(7; Status; Option)
        {
            Caption = 'Status';
            DataClassification = CustomerContent;
            OptionMembers = Open,"In Progress",Completed;
            OptionCaption = 'Open,In Progress,Completed';
        }
    }

    keys
    {
        key(PK; "Project Code", "Task Code")
        {
            Clustered = true;
        }
    }
}

page 70102 "Project Card"
{
    Caption = 'Project Card';
    PageType = Card;
    SourceTable = Project;
    ApplicationArea = All;
    UsageCategory = None;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("Project Code"; Rec."Project Code")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the unique code of the project.';
                }
                field(Name; Rec.Name)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the name of the project.';
                }
                field("Start Date"; Rec."Start Date")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the start date of the project.';
                }
                field("End Date"; Rec."End Date")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the end date of the project.';
                }
                field(Status; Rec.Status)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the current status of the project.';
                }
                field("Budget Amount"; Rec."Budget Amount")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the budget amount of the project.';
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(Activate)
            {
                Caption = 'Activate';
                ApplicationArea = All;
                Image = Approve;
                ToolTip = 'Activate the project.';

                trigger OnAction()
                var
                    ProjectManagement: Codeunit "Project Management";
                begin
                    ProjectManagement.ActivateProject(Rec."Project Code");
                    CurrPage.Update(false);
                end;
            }
            action(Complete)
            {
                Caption = 'Complete';
                ApplicationArea = All;
                Image = Completed;
                ToolTip = 'Complete the project.';

                trigger OnAction()
                var
                    ProjectManagement: Codeunit "Project Management";
                begin
                    ProjectManagement.CompleteProject(Rec."Project Code");
                    CurrPage.Update(false);
                end;
            }
            action(TotalEstimatedHours)
            {
                Caption = 'Show Total Estimated Hours';
                ApplicationArea = All;
                Image = Calculate;
                ToolTip = 'Show the total estimated hours of all related tasks.';

                trigger OnAction()
                begin
                    Message(TotalEstimatedHoursMsg, Rec.CalculateTotalEstimatedHours());
                end;
            }
        }
        area(Promoted)
        {
            group(Category_Process)
            {
                actionref(Activate_Promoted; Activate) { }
                actionref(Complete_Promoted; Complete) { }
                actionref(TotalEstimatedHours_Promoted; TotalEstimatedHours) { }
            }
        }
    }

    var
        TotalEstimatedHoursMsg: Label 'Total estimated hours: %1', Comment = '%1 = total estimated hours';
}

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