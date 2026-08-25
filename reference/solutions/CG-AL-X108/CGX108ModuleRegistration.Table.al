table 70680 "CG X108 Module Registration"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Module Code"; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Entitled"; Boolean)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Module Code")
        {
            Clustered = true;
        }
    }
}
