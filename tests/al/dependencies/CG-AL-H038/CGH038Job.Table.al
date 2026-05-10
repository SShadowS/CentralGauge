table 69380 "CG H038 Job"
{
    Caption = 'CG H038 Job';
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
