table 70795 "CG X119 Charge"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Description; Text[50]) { }
        field(3; "Description 2"; Text[50]) { }
        field(4; "Unit of Measure Code"; Code[10]) { }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
