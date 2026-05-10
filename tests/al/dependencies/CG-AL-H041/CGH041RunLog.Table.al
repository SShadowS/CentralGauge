table 69411 "CG H041 Run Log"
{
    Caption = 'CG H041 Run Log';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(10; "Outcomes"; Text[250])
        {
            Caption = 'Outcomes';
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
