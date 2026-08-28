table 71204 "CG X144 Intake Log"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Document No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Message; Text[250]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
