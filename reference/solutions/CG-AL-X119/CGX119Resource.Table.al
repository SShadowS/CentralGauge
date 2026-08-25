table 70794 "CG X119 Resource"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Name; Text[50]) { }
        field(3; "Base Unit of Measure"; Code[10]) { }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
