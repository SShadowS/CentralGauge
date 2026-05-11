table 69440 "CG H044 Doc"
{
    Caption = 'CG H044 Doc';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(10; "Marker"; Code[10])
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
