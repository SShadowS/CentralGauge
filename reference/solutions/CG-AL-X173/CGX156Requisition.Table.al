table 71400 "CG X156 Requisition"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; Description; Text[100]) { DataClassification = CustomerContent; }
        field(3; Quantity; Decimal) { DataClassification = CustomerContent; }
        field(4; Status; Enum "CG X156 Requisition Status") { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
