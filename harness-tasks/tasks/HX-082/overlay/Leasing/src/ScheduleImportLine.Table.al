table 70327 "CGR Schedule Import Line"
{
    TableType = Temporary;
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Due Date"; Date) { }
        field(3; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
    }
}
