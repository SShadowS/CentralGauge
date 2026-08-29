table 71512 "CG X167 Audit Result"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "External Ref"; Code[30]) { DataClassification = CustomerContent; }
        field(2; Status; Enum "CG X167 Audit Status") { DataClassification = CustomerContent; }
        field(3; "Import Amount"; Decimal) { DataClassification = CustomerContent; }
        field(4; "Posted Amount"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "External Ref") { Clustered = true; }
    }
}
