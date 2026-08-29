table 71311 "CG X147 Attribute Default"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entity Type"; Enum "CG X147 Entity Type") { }
        field(2; "Entity No."; Code[20]) { }
        field(3; "Attribute Code"; Code[20]) { }
        field(4; Value; Code[20]) { }
    }

    keys
    {
        key(PK; "Entity Type", "Entity No.", "Attribute Code")
        {
            Clustered = true;
        }
    }
}
