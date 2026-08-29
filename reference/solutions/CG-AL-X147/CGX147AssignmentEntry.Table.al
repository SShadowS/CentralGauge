table 71312 "CG X147 Assignment Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Entity Type"; Enum "CG X147 Entity Type") { }
        field(3; "Entity No."; Code[20]) { }
        field(4; "Attribute Code"; Code[20]) { }
        field(5; "Resolved Value"; Code[20]) { }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
