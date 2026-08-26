table 70810 "CG X121 Contract Header"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Plan Code"; Code[10])
        {
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                Rec."Lines Need Recreate" := true;
            end;
        }
        field(3; "Region Code"; Code[10])
        {
            DataClassification = CustomerContent;

            trigger OnValidate()
            begin
                Rec."Lines Need Recreate" := true;
            end;
        }
        field(4; "Contact Name"; Text[50]) { DataClassification = CustomerContent; }
        field(5; "Lines Need Recreate"; Boolean) { DataClassification = CustomerContent; }
        field(6; "Last Line Entry No."; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
