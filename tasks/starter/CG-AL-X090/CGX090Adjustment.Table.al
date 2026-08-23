table 70551 "CG X090 Adjustment"
{
    DataClassification = CustomerContent;
    Caption = 'CG X090 Adjustment';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
            DataClassification = CustomerContent;
        }
        field(2; "Case No."; Code[20])
        {
            Caption = 'Case No.';
            DataClassification = CustomerContent;
            TableRelation = "CG X090 Case"."No.";
        }
        field(3; "Team Code"; Code[20])
        {
            Caption = 'Team Code';
            DataClassification = CustomerContent;
        }
        field(4; Amount; Decimal)
        {
            Caption = 'Amount';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
