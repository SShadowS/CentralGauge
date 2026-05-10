table 69370 "CG H037 Doc"
{
    Caption = 'CG H037 Doc';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(10; "Status"; Code[10])
        {
            Caption = 'Status';
        }
        field(20; "Migrated"; Boolean)
        {
            Caption = 'Migrated';
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}
