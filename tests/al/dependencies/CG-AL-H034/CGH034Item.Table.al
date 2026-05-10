table 69340 "CG H034 Item"
{
    Caption = 'CG H034 Item';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(10; "Status"; Boolean)
        {
            Caption = 'Status';
        }
        field(20; "Marker"; Code[10])
        {
            Caption = 'Marker';
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
