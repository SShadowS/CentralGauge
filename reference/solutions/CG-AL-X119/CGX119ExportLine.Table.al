table 70796 "CG X119 Export Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Line Type"; Enum "CG X119 Line Type") { }
        field(4; Name; Text[50]) { }
        field(5; "Seller ID"; Code[20]) { }
        field(6; "Unit of Measure Code"; Code[10]) { }
    }

    keys
    {
        key(PK; "Document No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
