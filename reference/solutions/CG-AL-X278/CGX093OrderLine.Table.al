table 70581 "CG X093 Order Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Order No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Line No."; Integer)
        {
            DataClassification = CustomerContent;
        }
        field(3; "Item No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(4; Description; Text[100])
        {
            DataClassification = CustomerContent;
        }
        field(5; Quantity; Decimal)
        {
            DataClassification = CustomerContent;
        }
        field(6; "Unit Price"; Decimal)
        {
            DataClassification = CustomerContent;
        }
        field(7; "Line Amount"; Decimal)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Order No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
