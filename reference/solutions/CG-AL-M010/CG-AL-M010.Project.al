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
