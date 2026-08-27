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
