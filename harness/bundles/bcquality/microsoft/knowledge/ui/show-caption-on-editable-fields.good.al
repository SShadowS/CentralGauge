page 50200 "UI Sample Editable Caption Good"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            field("Customer Name"; Rec.Name)
            {
                ApplicationArea = All;
            }
        }
    }
}
