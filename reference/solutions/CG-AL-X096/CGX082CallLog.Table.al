table 70470 "CG X082 Call Log"
{
    Caption = 'CG X082 Call Log';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(2; "Endpoint"; Text[250])
        {
            Caption = 'Endpoint';
        }
        field(3; "Succeeded"; Boolean)
        {
            Caption = 'Succeeded';
        }
        field(4; "Total Backoff (ms)"; Integer)
        {
            Caption = 'Total Backoff (ms)';
        }
        field(5; "Logged At"; DateTime)
        {
            Caption = 'Logged At';
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
