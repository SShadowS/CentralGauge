table 70830 "CG X123 Labor Entry"
{
    DataClassification = CustomerContent;
    Caption = 'CG X123 Labor Entry';

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Project Code"; Code[20])
        {
            Caption = 'Project Code';
        }
        field(3; Hours; Decimal)
        {
            Caption = 'Hours';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(ByProject; "Project Code", Hours)
        {
            SumIndexFields = Hours;
        }
    }
}
