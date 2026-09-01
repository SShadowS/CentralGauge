table 70870 "CG X127 Site Setup"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Site Code"; Code[10])
        {
            DataClassification = CustomerContent;
        }
        field(2; Restricted; Boolean)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Site Code")
        {
            Clustered = true;
        }
    }
}
