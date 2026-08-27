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
